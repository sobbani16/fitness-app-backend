const { getPrisma } = require('../lib/prisma');
const include = { exerciseSets: { orderBy: { setNumber: 'asc' } } };
function output(s) {
  if (!s) return null;
  return { id:s.id, userId:s.userId, exerciseType:s.workoutType, createdAt:s.startedAt.toISOString(), updatedAt:s.endedAt.toISOString(), sets:s.exerciseSets.map(x=>({reps:x.reps,weight:x.weightLbs,timestamp:s.endedAt.toISOString()})) };
}
function validate(set) {
  if (!Number.isInteger(set.reps) || set.reps < 1 || set.reps > 1000) throw new Error('reps must be a positive integer up to 1000');
  if (!Number.isFinite(set.weight) || set.weight < 0 || set.weight > 2000) throw new Error('weight must be between 0 and 2000');
  return { reps:set.reps, weightLbs:set.weight };
}
module.exports = {
  async listForUser(userId) { return (await getPrisma().workoutSession.findMany({where:{userId},include,orderBy:{startedAt:'desc'},take:200})).map(output); },
  async findLastSessionForExercise(userId,exerciseType) { return output(await getPrisma().workoutSession.findFirst({where:{userId,workoutType:exerciseType},include,orderBy:{startedAt:'desc'}})); },
  async create(userId,{exerciseType,sets=[]}) {
    if (typeof exerciseType !== 'string' || !exerciseType.trim() || exerciseType.length > 100 || !Array.isArray(sets) || sets.length > 100) throw new Error('Invalid exercise or sets');
    const normalized=sets.map(validate), now=new Date();
    return output(await getPrisma().workoutSession.create({data:{userId,workoutType:exerciseType,durationMinutes:0,startedAt:now,endedAt:now,exerciseSets:{create:normalized.map((x,i)=>({...x,exerciseName:exerciseType,setNumber:i+1}))}},include}));
  },
  async addSet(userId,id,set) {
    const normalized=validate(set);
    return getPrisma().$transaction(async tx=>{
      // Serialize concurrent additions to preserve set ordering.
      await tx.$queryRaw`SELECT id FROM "WorkoutSession" WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`;
      const s=await tx.workoutSession.findFirst({where:{id,userId},include}); if(!s)return null;
      const now=new Date();
      return output(await tx.workoutSession.update({where:{id},data:{endedAt:now,durationMinutes:Math.min(240,Math.round((now-s.startedAt)/60000)),exerciseSets:{create:{...normalized,exerciseName:s.workoutType,setNumber:s.exerciseSets.length+1}}},include}));
    });
  }
};
