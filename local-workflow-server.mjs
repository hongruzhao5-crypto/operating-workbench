import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.WORKBENCH_PORT || 4318);
const runtime = '/Users/Admin/Documents/流程效能部/经营工作台运行记录';
const commands = {
  product_card: ['python3','/Users/Admin/Documents/流程效能部/商品卡核算工具/calculate_product_card_from_orders.py'],
  slice: ['python3','/Users/Admin/Documents/流程效能部/切片核算工具/calculate_slice_from_verified_batch.py','--as-of-date',new Date(Date.now()-86400000).toISOString().slice(0,10),'--period','month']
};
const jobs = new Map();
await fs.mkdir(runtime,{recursive:true});
const save=async job=>fs.writeFile(path.join(runtime,`${job.id}.json`),JSON.stringify(job,null,2));
const send=(res,code,data)=>{res.writeHead(code,{'content-type':'application/json','access-control-allow-origin':'*'});res.end(JSON.stringify(data))};
function start(job){const [cmd,...args]=commands[job.type];job.status='running';job.stage=job.type==='product_card'?'正在读取已核验订单、飞书登记与千川消耗':'正在读取已核验订单与计划级千川数据';job.startedAt=new Date().toISOString();save(job);const child=spawn(cmd,args,{stdio:['ignore','pipe','pipe']});job.pid=child.pid;job.child=child;let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('close',async code=>{delete job.child;job.finishedAt=new Date().toISOString();job.output=out.trim();job.error=err.trim();job.status=code===0?'verified':job.status==='stopped'?'stopped':'failed';job.stage=job.status==='verified'?'已完成核验，等待经营看板同步':job.status==='stopped'?'已停止，可继续本次运行':'核算未通过校验';await save(job)})}
const server=http.createServer(async(req,res)=>{if(req.method==='OPTIONS')return send(res,204,{});const u=new URL(req.url,`http://${req.headers.host}`);if(req.method==='GET'&&u.pathname==='/health')return send(res,200,{ok:true});if(req.method==='POST'&&u.pathname==='/jobs'){let body='';for await(const c of req)body+=c;const {type}=JSON.parse(body||'{}');if(!commands[type])return send(res,400,{error:'unsupported job type'});const job={id:randomUUID(),type,status:'queued',stage:'已创建运行单',createdAt:new Date().toISOString()};jobs.set(job.id,job);start(job);return send(res,201,job)}const match=u.pathname.match(/^\/jobs\/([^/]+)(?:\/(stop|continue))?$/);if(!match)return send(res,404,{error:'not found'});const job=jobs.get(match[1]);if(!job)return send(res,404,{error:'job not found'});if(req.method==='GET')return send(res,200,job);if(req.method==='POST'&&match[2]==='stop'&&job.child){job.status='stopped';job.stage='正在停止';job.child.kill('SIGTERM');await save(job);return send(res,200,job)}if(req.method==='POST'&&match[2]==='continue'&&['failed','stopped'].includes(job.status)){start(job);return send(res,200,job)}return send(res,409,{error:'operation unavailable',job})});
server.listen(port,'127.0.0.1',()=>console.log(`workbench workflow server: http://127.0.0.1:${port}`));
