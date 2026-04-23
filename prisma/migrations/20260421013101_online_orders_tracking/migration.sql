/*
  Warnings:

  - A unique constraint covering the columns `[customerToken]` on the table `orders` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "OnlineStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "OrderType" ADD VALUE 'ONLINE';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "customerToken" TEXT,
ADD COLUMN     "deliveryLat" DOUBLE PRECISION,
ADD COLUMN     "deliveryLng" DOUBLE PRECISION,
ADD COLUMN     "deliveryUserId" INTEGER,
ADD COLUMN     "onlineStatus" "OnlineStatus";

-- CreateIndex
CREATE UNIQUE INDEX "orders_customerToken_key" ON "orders"("customerToken");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_deliveryUserId_fkey" FOREIGN KEY ("deliveryUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
