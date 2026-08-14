import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_SEED_EMAIL;
  const password = process.env.ADMIN_SEED_PASSWORD;
  const nombre = process.env.ADMIN_SEED_NOMBRE || 'Administrador';

  if (!email || !password) {
    console.log('ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD no están definidos en .env, se omite el seed.');
    return;
  }

  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) {
    console.log(`Ya existe un usuario ADMIN con email ${email}, no se crea uno nuevo.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.usuario.create({
    data: { nombre, email, passwordHash, rol: 'ADMIN' },
  });
  console.log(`Usuario ADMIN creado: ${admin.email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
