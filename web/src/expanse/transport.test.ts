import test from 'node:test';
import assert from 'node:assert/strict';
import { queryString, validateServer, validateFrame } from './transport';
test('configuration permits HTTPS subpaths and refuses credentials or mixed content',()=>{
  assert.equal(validateServer('https://world.example/expanse/','https:'),'https://world.example/expanse');
  assert.equal(validateServer('http://127.0.0.1:8788','http:'),'http://127.0.0.1:8788');
  for(const u of ['http://remote.example','https://user:password@world.example','https://world.example/?token=a','https://world.example/#a','file:///tmp/world'])assert.throws(()=>validateServer(u,'https:'));
  assert.throws(()=>validateServer('http://127.0.0.1:8788','https:'));
});
test('wire query preserves negative world coordinates and selected creature',()=>{assert.equal(queryString({x:-90,y:-60,w:56,h:40,creature:17}),'x=-90&y=-60&w=56&h=40&creature=17');});
test('incompatible and incoherent frames are not presented as shared state',()=>{
  for(const f of [null,{}, {v:2,tick:1}, {v:1,tick:2,bounds:{},summary:{},view:{tick:1,tiles:[]},residents:[],discoveries:[],minimap:{}}]) assert.throws(()=>validateFrame(f));
});
