import { prisma } from './db.js'; import { emailQueue, enqueue, connection } from './queue.js';
const jobs=await prisma.emailJob.findMany({where:{status:'SCHEDULED'}}); let restored=0;
for(const row of jobs){if(!await emailQueue.getJob(row.id)){await enqueue(row.id,row.scheduledAt);restored++;}}
console.log(`Reconciled ${jobs.length} scheduled rows; restored ${restored} missing jobs.`); await connection.quit(); await prisma.$disconnect();
