const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {fetchSources}=require('../scripts/fetch-nutrient-sources');
let directory;
beforeEach(()=>{directory=fs.mkdtempSync(path.join(os.tmpdir(),'nutrient-fetch-'));});
afterEach(()=>fs.rmSync(directory,{recursive:true,force:true}));
test('cached records resume without a second request',async()=>{
 const fetcher=jest.fn(async()=>({ok:true,json:async()=>[{fdcId:123}],headers:{get:()=>null}}));
 const options={apiKey:'test',fetcher,pause:async()=>{}};
 expect((await fetchSources(['123','123'],directory,options)).fetched).toBe(1);
 expect((await fetchSources(['123'],directory,options)).requested).toBe(0);
 expect(fetcher).toHaveBeenCalledTimes(1);
 expect(JSON.parse(fs.readFileSync(path.join(directory,'123.json'))).food.fdcId).toBe(123);
});
test('rate limit stops requests and retains all pending IDs',async()=>{
 const ids=Array.from({length:25},(_,i)=>String(i+1));
 const fetcher=jest.fn(async()=>({ok:false,status:429}));
 const result=await fetchSources(ids,directory,{apiKey:'test',fetcher,pause:async()=>{}});
 expect(result.pending).toEqual(ids);expect(fetcher).toHaveBeenCalledTimes(1);
 expect(fs.readdirSync(directory)).toEqual([]);
});
test('missing credentials leave data pending',async()=>{
 const fetcher=jest.fn();
 expect((await fetchSources(['1'],directory,{apiKey:'',fetcher})).pending).toBe('USDA_API_KEY_MISSING');
 expect(fetcher).not.toHaveBeenCalled();
});
