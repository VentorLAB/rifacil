import "./_env";
import { PrismaClient } from "../src/generated";
const prisma = new PrismaClient();

const ORLANDO = "cmqg5sisi0000sz3bc27a4u9y";
const EDUARD = "cmqg5snwh0007sz3btkyq2o7q";

async function main() {
  // 1) Migración (idempotente).
  await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "businessOwnerId" TEXT`);
  await prisma.$executeRawUnsafe(`DO $$ BEGIN
    ALTER TABLE "User" ADD CONSTRAINT "User_businessOwnerId_fkey"
      FOREIGN KEY ("businessOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "User_businessOwnerId_idx" ON "User"("businessOwnerId")`);

  // 2) Roles + enlace de negocio (Orlando = raíz SUPER_ADMIN; Eduard = ADMIN miembro).
  await prisma.$executeRawUnsafe(`UPDATE "User" SET role='SUPER_ADMIN', "businessOwnerId"=NULL WHERE id=$1`, ORLANDO);
  await prisma.$executeRawUnsafe(`UPDATE "User" SET role='ADMIN', "businessOwnerId"=$1 WHERE id=$2`, ORLANDO, EDUARD);

  // 3) Contactos privados: devolver a Eduard los contactos que mi consolidación movió a Orlando
  //    y que en realidad eran de su cartera (los compradores de El Dubái que él cargó).
  const eduardContacts = await prisma.contact.updateMany({
    where: { name: { in: ["Eduard Pernia", "Marcos Pérez"] }, userId: ORLANDO },
    data: { userId: EDUARD },
  });

  const check = await prisma.user.findMany({
    where: { id: { in: [ORLANDO, EDUARD] } },
    select: { name: true, role: true, businessOwnerId: true },
  });
  console.log(JSON.stringify({ contactsReturnedToEduard: eduardContacts.count, users: check }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
