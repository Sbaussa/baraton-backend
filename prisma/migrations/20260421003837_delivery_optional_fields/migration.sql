/*
  Warnings:

  - You are about to drop the column `estimatedMin` on the `delivery_info` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "delivery_info" DROP COLUMN "estimatedMin",
ALTER COLUMN "customerName" DROP NOT NULL,
ALTER COLUMN "phone" DROP NOT NULL;
