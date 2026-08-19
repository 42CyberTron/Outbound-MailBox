import { connection } from './queue.js';
// One atomic operation reserves both the hour quota and the sender gap. It returns the next eligible epoch ms.
const LUA = `
local hourly=KEYS[1]; local gap=KEYS[2]; local now=tonumber(ARGV[1]); local limit=tonumber(ARGV[2]); local minGap=tonumber(ARGV[3]); local hourEnd=tonumber(ARGV[4]);
local count=tonumber(redis.call('GET', hourly) or '0'); local last=tonumber(redis.call('GET', gap) or '0');
if count >= limit then return hourEnd end
local eligible=math.max(now,last + minGap)
if eligible >= hourEnd then return hourEnd end
redis.call('INCR',hourly); redis.call('PEXPIREAT',hourly,hourEnd); redis.call('SET',gap,eligible,'PX',minGap + 3600000)
return eligible`;
export async function reserveSender(sender: string, hourlyLimit: number, minDelayMs: number) {
 const now=Date.now(), hourEnd=(Math.floor(now/3600000)+1)*3600000, bucket=Math.floor(now/3600000);
 return Number(await connection.eval(LUA,2,`rate:${sender}:${bucket}`,`gap:${sender}`,now,hourlyLimit,minDelayMs,hourEnd));
}
