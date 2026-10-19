// Promove um usuário existente a proprietário/master (acesso ao Painel master).
// Uso: node prisma/scripts/make-owner.mjs <email>
//   (ou defina MAKE_OWNER_EMAIL). Requer DATABASE_URL no ambiente.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const email = (process.argv[2] ?? process.env.MAKE_OWNER_EMAIL ?? '').trim().toLowerCase();
if (!email) {
  console.error('Uso: node prisma/scripts/make-owner.mjs <email>');
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL não definida.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 2 }) });

try {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`Nenhum usuário com o e-mail "${email}". Cadastre-se primeiro em /cadastro.`);
    process.exit(2);
  }
  if (user.isMaster && user.role === 'OWNER') {
    console.log(`"${email}" já é proprietário/master. Nada a fazer.`);
    process.exit(0);
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { isMaster: true, role: 'OWNER', canViewAllReports: true, active: true },
  });
  console.log(`Pronto: "${email}" agora é proprietário/master (acesso ao Painel master).`);
} finally {
  await prisma.$disconnect();
}
