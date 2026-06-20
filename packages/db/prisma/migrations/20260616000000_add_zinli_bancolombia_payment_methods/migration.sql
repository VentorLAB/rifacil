-- Agrega métodos de pago del negocio Pernía: Zinli (billetera USD VE) y Bancolombia (banco CO).
-- ALTER TYPE ... ADD VALUE es idempotente con IF NOT EXISTS (ya aplicado vía script en la base productiva).
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'ZINLI';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'BANCOLOMBIA';
