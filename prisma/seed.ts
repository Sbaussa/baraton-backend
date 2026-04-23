import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Limpiando e insertando datos...');

  // ── Limpiar productos y categorías existentes ────────────────────────────────
  await prisma.orderItem.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.category.deleteMany({});
  console.log('🗑  Productos y categorías anteriores eliminados');

  // ── Usuarios ─────────────────────────────────────────────────────────────────
  const hashes = await Promise.all([
    bcrypt.hash('admin123', 10),
    bcrypt.hash('cajera123', 10),
    bcrypt.hash('cocina123', 10),
    bcrypt.hash('domicilio123', 10),
  ]);

  await prisma.user.upsert({ where: { email: 'admin@baraton.com' },     update: {}, create: { name: 'Administrador', email: 'admin@baraton.com',     password: hashes[0], role: 'ADMIN'    } });
  await prisma.user.upsert({ where: { email: 'cajera@baraton.com' },    update: {}, create: { name: 'Cajera',         email: 'cajera@baraton.com',    password: hashes[1], role: 'CASHIER'  } });
  await prisma.user.upsert({ where: { email: 'cocina@baraton.com' },    update: {}, create: { name: 'Cocinero',       email: 'cocina@baraton.com',    password: hashes[2], role: 'KITCHEN'  } });
  await prisma.user.upsert({ where: { email: 'domicilio@baraton.com' }, update: {}, create: { name: 'Domiciliario',   email: 'domicilio@baraton.com', password: hashes[3], role: 'DELIVERY' } });

  // ── Categorías (creación fresca, sin duplicados) ──────────────────────────────
  const categoriasData = [
    { name: 'Sopas',       color: '#F59E0B' },
    { name: 'Proteínas',   color: '#EF4444' },
    { name: 'Asados',      color: '#F97316' },
    { name: 'Bebidas',     color: '#3B82F6' },
    { name: 'Adicionales', color: '#6B7280' },
    { name: 'Postres',     color: '#8B5CF6' },
  ];

  const cats: Record<string, number> = {};
  for (const cat of categoriasData) {
    const c = await prisma.category.create({ data: cat });
    cats[cat.name] = c.id;
  }
  console.log('📂 Categorías creadas:', Object.keys(cats).join(', '));

  // ── Productos ─────────────────────────────────────────────────────────────────
  const productos = [
    // SOPAS
    { name: 'Sancocho de Costilla',    price: 10000, categoryId: cats['Sopas'] },

    // PROTEÍNAS $15.000 (almuerzo del día)
    { name: 'Desmechada',              price: 15000, categoryId: cats['Proteínas'] },
    { name: 'Carne Posta',             price: 15000, categoryId: cats['Proteínas'] },
    { name: 'Pollo Guisado',           price: 15000, categoryId: cats['Proteínas'] },
    { name: 'Fajitas Mixta',           price: 15000, categoryId: cats['Proteínas'] },
    { name: 'Filete de Tilapia Frito', price: 15000, categoryId: cats['Proteínas'] },
    { name: 'Filete de Chivo',         price: 15000, categoryId: cats['Proteínas'] },
    { name: 'Hígado Encebollado',      price: 15000, categoryId: cats['Proteínas'] },

    // PROTEÍNAS precio especial
    { name: 'Gallina Guisada',                    price: 16000, categoryId: cats['Proteínas'] },
    { name: 'Cerdo Agridulce',                    price: 16000, categoryId: cats['Proteínas'] },
    { name: 'Mojarra Frita',                      price: 20000, categoryId: cats['Proteínas'] },
    { name: 'Pechuga en Salsa de Champiñones',    price: 17000, categoryId: cats['Proteínas'] },

    // PROTEÍNAS adicionales $15.000
    { name: 'Carne Posta',                        price: 15000, categoryId: cats['Proteínas'] },
    { name: 'Pollo Guisado',                      price: 15000, categoryId: cats['Proteínas'] },
    { name: 'Lomo de Cerdo a la Coca-Cola',       price: 15000, categoryId: cats['Proteínas'] },
    { name: 'Filete de Chivo',                    price: 15000, categoryId: cats['Proteínas'] },

    // ASADOS $17.000
    { name: 'Pechuga Asada',                      price: 17000, categoryId: cats['Asados'] },
    { name: 'Carne Asada',                         price: 17000, categoryId: cats['Asados'] },
    { name: 'Carne Bisteck',                       price: 17000, categoryId: cats['Asados'] },
    { name: 'Chuleta Asada',                       price: 17000, categoryId: cats['Asados'] },
    { name: 'Chicharrones',                        price: 17000, categoryId: cats['Asados'] },
    { name: 'Pechuga en Salsa de Champiñones',     price: 17000, categoryId: cats['Asados'] },
    { name: 'Lomo de Cerdo a la Coca-Cola',        price: 17000, categoryId: cats['Asados'] },

    // ASADOS ESPECIAL $20.000 (con ensalada, papas fritas y jugo)
    { name: 'Pechuga Asada Especial',  price: 20000, categoryId: cats['Asados'] },
    { name: 'Carne Asada Especial',    price: 20000, categoryId: cats['Asados'] },
    { name: 'Carne Bisteck Especial',  price: 20000, categoryId: cats['Asados'] },
    { name: 'Chuleta Asada Especial',  price: 20000, categoryId: cats['Asados'] },
    { name: 'Chicharrones Especial',   price: 20000, categoryId: cats['Asados'] },

    // ADICIONALES
    { name: 'Porción de Ensalada',     price: 3000,  categoryId: cats['Adicionales'] },
    { name: 'Porción de Arroz',        price: 3000,  categoryId: cats['Adicionales'] },
    { name: 'Porción de Patacón',      price: 4000,  categoryId: cats['Adicionales'] },
    { name: 'Porción de Tajadas',      price: 3000,  categoryId: cats['Adicionales'] },
    { name: 'Porción de Papas',        price: 7000,  categoryId: cats['Adicionales'] },
  ];

  await prisma.product.createMany({ data: productos });
  console.log(`🍽  ${productos.length} productos creados`);

  console.log('\n✅ Seed completado exitosamente');
  console.log('   Admin:        admin@baraton.com / admin123');
  console.log('   Cajera:       cajera@baraton.com / cajera123');
  console.log('   Cocina:       cocina@baraton.com / cocina123');
  console.log('   Domiciliario: domicilio@baraton.com / domicilio123');
}

main().catch(console.error).finally(() => prisma.$disconnect());