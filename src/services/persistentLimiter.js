const { getPrisma }=require('../lib/prisma');
function createPersistentLimiter({limit,kind='chat'}) {
 const shape=count=>({limit,used:count,remaining:Math.max(0,limit-count)});
 const key=userId=>({userId,date:new Date().toISOString().slice(0,10),kind});
 return {
  async status(userId){const record=await getPrisma().apiUsage.findUnique({where:{userId_date_kind:key(userId)}});return shape(record?.count||0);},
  async consume(userId){
   const k=key(userId);
   const rows=await getPrisma().$queryRaw`INSERT INTO "ApiUsage" ("userId","date","kind","count") VALUES (${k.userId},${k.date},${k.kind},1) ON CONFLICT ("userId","date","kind") DO UPDATE SET "count"="ApiUsage"."count"+1 WHERE "ApiUsage"."count" < ${limit} RETURNING "count"`;
   return {allowed:rows.length>0,...shape(rows[0]?.count||limit)};
  }
 };
}
module.exports={createPersistentLimiter};
