import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AuthRequest } from '../middlewares/auth.middleware';

const prisma = new PrismaClient();

const PRINTER_1 = 'EPSON TM-T88V Receipt5';
const PRINTER_2 = 'POS Printer 203DPI  Series';

// ── ESC/POS ────────────────────────────────────────────────────────────────────
const ESC = 0x1b, GS = 0x1d;
const CMD = {
  INIT:         Buffer.from([ESC, 0x40]),
  ALIGN_LEFT:   Buffer.from([ESC, 0x61, 0x00]),
  ALIGN_CENTER: Buffer.from([ESC, 0x61, 0x01]),
  ALIGN_RIGHT:  Buffer.from([ESC, 0x61, 0x02]),
  BOLD_ON:      Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF:     Buffer.from([ESC, 0x45, 0x00]),
  DOUBLE_ON:    Buffer.from([GS,  0x21, 0x11]),
  DOUBLE_OFF:   Buffer.from([GS,  0x21, 0x00]),
  CUT:          Buffer.from([GS,  0x56, 0x41, 0x03]),
  LF:           Buffer.from([0x0a]),
};

const REPLACEMENTS: Record<string, string> = {
  'á':'a','é':'e','í':'i','ó':'o','ú':'u',
  'Á':'A','É':'E','Í':'I','Ó':'O','Ú':'U',
  'ñ':'n','Ñ':'N','¡':'!','¿':'?',
};

function text(str: string): Buffer {
  const clean = str.replace(/[áéíóúÁÉÍÓÚñÑ¡¿]/g, c => REPLACEMENTS[c] || c);
  return Buffer.from(clean + '\n', 'binary');
}

function line(char = '-', width = 42): Buffer { return text(char.repeat(width)); }

function row(c1: string, c2: string, c3: string, widths = [21, 10, 11]): Buffer {
  const pad = (s: string, w: number, right = false) => {
    s = String(s).slice(0, w);
    return right ? s.padStart(w) : s.padEnd(w);
  };
  return text(pad(c1, widths[0]) + pad(c2, widths[1], true) + pad(c3, widths[2], true));
}

// ── Formato de fecha/hora manual ──────────────────────────────────────────────
function formatDateTime(date: Date): string {
  const dd   = String(date.getDate()).padStart(2, '0');
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh   = date.getHours();
  const min  = String(date.getMinutes()).padStart(2, '0');
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const hora = String(hh % 12 || 12).padStart(2, '0');
  return `${dd}/${mm}/${yyyy}  ${hora}:${min} ${ampm}`;
}

function formatTime(date: Date): string {
  const hh   = date.getHours();
  const min  = String(date.getMinutes()).padStart(2, '0');
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const hora = String(hh % 12 || 12).padStart(2, '0');
  return `${hora}:${min} ${ampm}`;
}

// ── PowerShell RawPrint ───────────────────────────────────────────────────────
function buildPsScript(printerName: string, filePath: string): string {
  return `
$printerName = "${printerName}"
$filePath    = "${filePath.replace(/\\/g, '\\\\')}"
$bytes       = [System.IO.File]::ReadAllBytes($filePath)

$src = @"
using System;
using System.Runtime.InteropServices;
public class RawPrint {
  [DllImport("winspool.drv", CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv")]
  public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr h, int lvl, ref DOCINFO di);
  [DllImport("winspool.drv")]
  public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv")]
  public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv")]
  public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv")]
  public static extern bool WritePrinter(IntPtr h, IntPtr buf, int len, out int written);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
}
"@
Add-Type -TypeDefinition $src

$h = [IntPtr]::Zero
[RawPrint]::OpenPrinter($printerName, [ref]$h, [IntPtr]::Zero) | Out-Null

$di = New-Object RawPrint+DOCINFO
$di.pDocName    = "Receipt"
$di.pDataType   = "RAW"
$di.pOutputFile = $null

[RawPrint]::StartDocPrinter($h, 1, [ref]$di) | Out-Null
[RawPrint]::StartPagePrinter($h)              | Out-Null

$ptr     = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
$written = 0
[RawPrint]::WritePrinter($h, $ptr, $bytes.Length, [ref]$written) | Out-Null
[System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)

[RawPrint]::EndPagePrinter($h) | Out-Null
[RawPrint]::EndDocPrinter($h)  | Out-Null
[RawPrint]::ClosePrinter($h)   | Out-Null
Write-Output "OK:$written"
`;
}

function printToPrinter(printerName: string, receipt: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const id     = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const tmpBin = path.join(os.tmpdir(), `receipt_${id}.bin`);
    const tmpPs  = path.join(os.tmpdir(), `print_${id}.ps1`);
    const script = buildPsScript(printerName, tmpBin);

    fs.writeFile(tmpBin, receipt, errBin => {
      if (errBin) return reject(errBin);
      fs.writeFile(tmpPs, script, 'utf8', errPs => {
        if (errPs) return reject(errPs);
        const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpPs}"`;
        exec(cmd, (execErr, stdout, stderr) => {
          fs.unlink(tmpBin, () => {});
          fs.unlink(tmpPs,  () => {});
          if (execErr) return reject(new Error(stderr));
          resolve(stdout.trim());
        });
      });
    });
  });
}

async function sendToPrinters(receipt: Buffer, res: Response) {
  try {
    await Promise.all([
      printToPrinter(PRINTER_1, receipt),
      printToPrinter(PRINTER_2, receipt),
    ]);
    console.log('Impreso en ambas impresoras');
    res.json({ ok: true });
  } catch (err: any) {
    console.error('Error al imprimir:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── Ticket Factura ─────────────────────────────────────────────────────────────
export const printReceipt = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: Number(req.params.id) },
      include: { items: { include: { product: true } }, user: true, delivery: true },
    });
    if (!order) { res.status(404).json({ error: 'Pedido no encontrado' }); return; }

    const fecha = formatDateTime(new Date());

    const typeLabel: Record<string, string> = {
      MESA:      `Mesa ${order.tableNumber || '?'}`,
      DOMICILIO: 'Domicilio',
      LLEVAR:    'Para Llevar',
      ONLINE:    'Online',
    };

    const chunks: Buffer[] = [];
    const add = (...bufs: Buffer[]) => bufs.forEach(b => chunks.push(b));

    // ══ ENCABEZADO ══════════════════════════════════════
    add(CMD.INIT, CMD.ALIGN_CENTER, CMD.LF);
    add(line('='));
    add(CMD.BOLD_ON, CMD.DOUBLE_ON);
    add(text('EL NUEVO BARATON'));
    add(CMD.DOUBLE_OFF, CMD.BOLD_OFF);
    add(text('- Almuerzos y Domicilios -'));
    add(CMD.LF);
    add(text('Calle 70 #61 - Barranquilla'));
    add(text('Encargada: Claudia Marquez'));
    add(text('Tel: 312 2035078'));
    add(line('='));
    add(CMD.LF);

    // ══ INFO PEDIDO ═════════════════════════════════════
    add(CMD.ALIGN_LEFT);
    add(CMD.BOLD_ON);
    add(text('  COMPROBANTE DE PEDIDO '));
    add(CMD.BOLD_OFF);
    add(line('-'));
    add(text(`  N. Pedido : ${order.orderNumber}`));
    add(text(`  Tipo      : ${typeLabel[order.orderType] || order.orderType}`));
    add(text(`  Fecha     : ${fecha}`));
    add(text(`  Atendio   : ${order.user?.name || '-'}`));
    add(line('-'));

    // ══ DOMICILIO ═══════════════════════════════════════
    if ((order.orderType === 'DOMICILIO' || order.orderType === 'ONLINE') && order.delivery) {
      add(CMD.LF);
      add(CMD.ALIGN_CENTER, CMD.BOLD_ON);
      add(text('>> DATOS DE ENTREGA <<'));
      add(CMD.BOLD_OFF, CMD.ALIGN_LEFT);
      add(line('.'));
      if (order.delivery.customerName) add(text(`  Cliente  : ${order.delivery.customerName}`));
      if (order.delivery.phone)        add(text(`  Telefono : ${order.delivery.phone}`));
      add(text(`  Direccion: ${order.delivery.address}`));
      if (order.delivery.neighborhood) add(text(`  Barrio   : ${order.delivery.neighborhood}`));
      add(line('.'));
      add(CMD.LF);
    }

    // ══ ITEMS ═══════════════════════════════════════════
    add(CMD.BOLD_ON);
    add(row('  PRODUCTO', 'P.UNIT', 'TOTAL'));
    add(CMD.BOLD_OFF);
    add(line('-'));

    for (const item of order.items) {
      const nombre   = `  ${item.quantity}x ${item.product.name}`;
      const precio   = `$${item.unitPrice.toLocaleString('es-CO')}`;
      const subtotal = `$${(item.unitPrice * item.quantity).toLocaleString('es-CO')}`;
      if (nombre.length > 22) {
        add(text(nombre));
        add(row('', precio, subtotal));
      } else {
        add(row(nombre, precio, subtotal));
      }
    }

    add(line('-'));

    // ══ PAGO ════════════════════════════════════════════
    if (order.paymentMethod) {
      add(CMD.LF);
      add(text(`  Metodo de pago : ${order.paymentMethod}`));
      if (order.cashGiven)          add(text(`  Recibido       : $${order.cashGiven.toLocaleString('es-CO')}`));
      if (order.cashChange != null) add(text(`  Cambio         : $${order.cashChange.toLocaleString('es-CO')}`));
    }

    // ══ TOTAL ═══════════════════════════════════════════
    add(CMD.LF);
    add(line('='));
    add(CMD.ALIGN_CENTER, CMD.BOLD_ON, CMD.DOUBLE_ON);
    add(text(`TOTAL  $${order.total.toLocaleString('es-CO')}`));
    add(CMD.DOUBLE_OFF, CMD.BOLD_OFF);
    add(line('='));

    // ══ PIE ═════════════════════════════════════════════
    add(CMD.LF);
    add(CMD.ALIGN_CENTER);
    add(CMD.BOLD_ON);
    add(text('Gracias por su preferencia'));
    add(CMD.BOLD_OFF);
    add(text('¡Vuelva pronto!'));
    add(CMD.LF);
    add(line('-'));
    add(text('Baussa - 2026'));
    add(line('-'));
    add(CMD.LF, CMD.LF, CMD.CUT);

    await sendToPrinters(Buffer.concat(chunks), res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error imprimiendo' });
  }
};

// ── Ticket Cocina ──────────────────────────────────────────────────────────────
export const printKitchen = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: Number(req.params.id) },
      include: { items: { include: { product: true } }, user: true, delivery: true },
    });
    if (!order) { res.status(404).json({ error: 'Pedido no encontrado' }); return; }

    const timeStr    = formatTime(new Date());
    const isDelivery = order.orderType === 'DOMICILIO' || order.orderType === 'ONLINE';

    const chunks: Buffer[] = [];
    const add = (...bufs: Buffer[]) => bufs.forEach(b => chunks.push(b));

    // ══ ENCABEZADO ══════════════════════════════════════
    add(CMD.INIT, CMD.ALIGN_CENTER, CMD.LF);
    add(line('='));
    add(CMD.BOLD_ON, CMD.DOUBLE_ON);

    if (isDelivery) {
      add(text('** DOMICILIO **'));
    } else if (order.orderType === 'MESA') {
      add(text(`MESA  ${order.tableNumber || '?'}`));
    } else {
      add(text('PARA LLEVAR'));
    }

    add(CMD.DOUBLE_OFF, CMD.BOLD_OFF);
    add(line('='));
    add(CMD.LF);

    // ══ INFO ════════════════════════════════════════════
    add(CMD.ALIGN_LEFT, CMD.BOLD_ON);
    add(text(`  Pedido : #${order.orderNumber}`));
    add(text(`  Hora   : ${timeStr}`));
    add(text(`  Mesero : ${order.user?.name || '-'}`));
    add(CMD.BOLD_OFF);
    add(line('-'));
    add(CMD.LF);

    // ══ ITEMS ═══════════════════════════════════════════
    for (const item of order.items) {
      add(CMD.BOLD_ON, CMD.DOUBLE_ON);
      add(text(`  ${item.quantity}x ${item.product.name}`));
      add(CMD.DOUBLE_OFF, CMD.BOLD_OFF);
      if (item.notes) add(text(`     >> ${item.notes}`));
      add(CMD.LF);
    }

    add(line('-'));

    // ══ NOTAS ═══════════════════════════════════════════
    if (order.notes) {
      add(CMD.LF, CMD.ALIGN_CENTER, CMD.BOLD_ON);
      add(text('!! NOTAS DEL PEDIDO !!'));
      add(CMD.BOLD_OFF, CMD.ALIGN_LEFT);
      add(line('.'));
      add(CMD.DOUBLE_ON, text(`  ${order.notes}`), CMD.DOUBLE_OFF);
      add(line('.'));
      add(CMD.LF);
    }

    // ══ DATOS DOMICILIO ══════════════════════════════════
    if (isDelivery && order.delivery) {
      add(CMD.LF, CMD.ALIGN_CENTER, CMD.BOLD_ON);
      add(text('ENTREGAR A:'));
      add(CMD.BOLD_OFF, CMD.ALIGN_LEFT);
      add(line('.'));
      if (order.delivery.customerName) add(text(`  ${order.delivery.customerName}`));
      if (order.delivery.phone)        add(text(`  Tel: ${order.delivery.phone}`));
      add(text(`  Dir: ${order.delivery.address}`));
      if (order.delivery.neighborhood) add(text(`  ${order.delivery.neighborhood}`));
      add(line('.'));
    }

    add(CMD.LF, CMD.LF, CMD.LF, CMD.CUT);

    await sendToPrinters(Buffer.concat(chunks), res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error imprimiendo' });
  }
};