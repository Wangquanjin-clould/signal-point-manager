'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');

function zipEntry(zip, wantedName) {
  let offset = 0;
  while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = zip.toString('utf8', nameStart, nameStart + nameLength);
    const dataStart = nameStart + nameLength + extraLength;
    if (name === wantedName) return zip.toString('utf8', dataStart, dataStart + size);
    offset = dataStart + size;
  }
  throw new Error(`ZIP entry not found: ${wantedName}`);
}

test('免登录现场业务与管理员配置权限', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spt-access-'));
  // 用独立进程和数据库，避免测试修改实际点位数据。
  const app = spawn(process.execPath, ['-e', "const s=require('./server');s.on('listening',()=>process.send(s.address().port));"], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATA_DIR: dataDir, PORT: '0', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let errors = '';
  app.stderr.on('data', chunk => { errors += chunk; });
  try {
    const [port] = await Promise.race([
      once(app, 'message'),
      once(app, 'exit').then(() => { throw new Error(errors); }),
    ]);
    const request = async (url, method = 'GET', body, cookie) => {
      const res = await fetch(`http://127.0.0.1:${port}${url}`, {
        method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const contentType = res.headers.get('content-type') || '';
      const raw = contentType.includes('spreadsheetml') ? Buffer.from(await res.arrayBuffer()) : await res.text();
      return { status: res.status, data: contentType.includes('application/json') ? JSON.parse(raw) : raw,
        cookie: res.headers.get('set-cookie')?.split(';')[0] };
    };
    for (const url of ['/api/tree', '/api/points', '/api/modules', '/api/config', '/api/signal-types', '/api/summary', '/api/export']) {
      assert.equal((await request(url)).status, 200, url);
    }
    assert.equal((await request('/api/auth/me')).data.user, null);
    for (const url of ['/api/config/projects', '/api/module-models', '/api/signal-types', '/api/users']) {
      assert.equal((await request(url, 'POST', { name: 'blocked' })).status, 401, url);
    }
    assert.equal((await request('/api/auth/password', 'POST', {})).status, 401);
    const config = (await request('/api/config')).data;
    const fieldPart = config.parts.find(p => p.name === '现场');
    const motorPart = config.parts.find(p => p.name === '电机');
    const signals = (await request('/api/signal-types')).data.items;
    assert.ok(signals.every(s => s.part_id === fieldPart.id));
    const model = config.module_models[0];
    const payload = { project_id: config.projects[0].id, cabinet_id: config.cabinets[0].id,
      module_no: 'guest-test', module_type_id: model.module_type_id, module_model_id: model.id };
    const exportModules = [];
    const doType = config.module_types.find(type => type.name === 'DO');
    const doModel = config.module_models.find(item => item.module_type_id === doType.id);
    for (const [module_no, project_id, cabinet_id, point_name, selectedModel] of [
      ['export-a', config.projects[0].id, config.cabinets[0].id, 'EXPORT_A', model],
      ['export-a2', config.projects[0].id, config.cabinets[0].id, 'EXPORT_A2', model],
      ['export-b', config.projects[0].id, config.cabinets[1].id, 'EXPORT_B', { ...doModel, module_type_id: doType.id }],
      ['export-other', config.projects[1].id, config.cabinets[0].id, 'EXPORT_OTHER', model],
    ]) {
      const fixture = await request('/api/modules', 'POST', { ...payload, module_no, project_id, cabinet_id,
        module_type_id: selectedModel.module_type_id, module_model_id: selectedModel.id });
      assert.equal(fixture.status, 200);
      exportModules.push(fixture.data.id);
      const point = (await request(`/api/points?module_id=${fixture.data.id}`)).data.items[0];
      await request(`/api/points/${point.id}`, 'PATCH', { point_name, part: fieldPart.param });
    }
    const cabinetChannels=await request('/api/points?project_id='+config.projects[0].id+'&cabinet_id='+config.cabinets[0].id);
    assert.equal(cabinetChannels.status,200);
    assert.equal(cabinetChannels.data.items.length,model.channel_count*2);
    assert.ok(cabinetChannels.data.items.every(row=>exportModules.slice(0,2).includes(row.module_id)));
    assert.ok(cabinetChannels.data.items.some(row=>row.point_name==='EXPORT_A'));
    assert.ok(cabinetChannels.data.items.some(row=>row.point_name==='EXPORT_A2'));
    assert.ok(cabinetChannels.data.items.some(row=>!row.point_name));
    assert.ok(cabinetChannels.data.items.every(row=>typeof row.plc_expression==='string'));
    assert.equal((await request('/api/points?cabinet_id='+config.cabinets[0].id)).status,400);
    assert.equal((await request('/api/points?project_id='+config.projects[0].id+'&cabinet_id=invalid')).status,400);
    const projectWorkbookResponse = await request(`/api/export?project_id=${config.projects[0].id}`);
    const treeBeforeCabinetSort = (await request('/api/tree')).data.projects;
    const cabinetIds = treeBeforeCabinetSort.find(p => p.id === config.projects[0].id).cabinets.map(c => c.id);
    const otherCabinetIds = treeBeforeCabinetSort.find(p => p.id === config.projects[1].id).cabinets.map(c => c.id);
    assert.equal((await request(`/api/projects/${config.projects[0].id}/cabinets/reorder`, 'POST', { ids: [...cabinetIds].reverse() })).status, 200);
    const treeAfterCabinetSort = (await request('/api/tree')).data.projects;
    assert.deepEqual(treeAfterCabinetSort.find(p => p.id === config.projects[0].id).cabinets.map(c => c.id), [...cabinetIds].reverse());
    assert.deepEqual(treeAfterCabinetSort.find(p => p.id === config.projects[1].id).cabinets.map(c => c.id), otherCabinetIds);
    assert.equal((await request(`/api/projects/${config.projects[0].id}/cabinets/reorder`, 'POST', { ids: cabinetIds.slice(1) })).status, 409);
    assert.equal((await request(`/api/projects/${config.projects[0].id}/cabinets/reorder`, 'POST', { ids: [cabinetIds[0], cabinetIds[0]] })).status, 400);
    assert.equal((await request('/api/projects/999999/cabinets/reorder', 'POST', { ids: [] })).status, 404);
    assert.equal(projectWorkbookResponse.status, 200);
    const diSheet = zipEntry(projectWorkbookResponse.data, 'xl/worksheets/sheet1.xml');
    const doSheet = zipEntry(projectWorkbookResponse.data, 'xl/worksheets/sheet2.xml');
    assert.ok(zipEntry(projectWorkbookResponse.data, 'xl/workbook.xml').includes('DI模块'));
    assert.ok(zipEntry(projectWorkbookResponse.data, 'xl/workbook.xml').includes('DO模块'));
    assert.ok(diSheet.includes('EXPORT_A') && diSheet.includes('EXPORT_A2') && !diSheet.includes('EXPORT_B') && !diSheet.includes('EXPORT_OTHER'));
    assert.ok(doSheet.includes('EXPORT_B') && !doSheet.includes('EXPORT_A') && !doSheet.includes('EXPORT_OTHER'));
    assert.ok(diSheet.includes('PLC点位表达式') && doSheet.includes('PLC点位表达式'));
    assert.match(diSheet, /<row r="\d+"><\/row>/, 'DI modules are separated by a blank row');
    const cabinetWorkbookResponse = await request(`/api/export?project_id=${config.projects[0].id}&cabinet_id=${config.cabinets[0].id}`);
    const cabinetDi = zipEntry(cabinetWorkbookResponse.data, 'xl/worksheets/sheet1.xml');
    const cabinetDo = zipEntry(cabinetWorkbookResponse.data, 'xl/worksheets/sheet2.xml');
    assert.ok(cabinetDi.includes('EXPORT_A') && cabinetDi.includes('EXPORT_A2') && !cabinetDi.includes('EXPORT_B') && !cabinetDi.includes('EXPORT_OTHER'));
    assert.ok(!cabinetDo.includes('EXPORT_B'));
    const moduleCsv = await request(`/api/export?module_id=${exportModules[0]}`);
    assert.ok(moduleCsv.data.includes('EXPORT_A') && !moduleCsv.data.includes('EXPORT_B'));
    assert.equal((await request(`/api/export?cabinet_id=${config.cabinets[0].id}`)).status, 400);
    assert.equal((await request('/api/export?project_id=999999')).status, 404);
    assert.equal((await request('/api/export?module_id=999999')).status, 404);
    for (const id of exportModules) await request(`/api/modules/${id}`, 'DELETE');
    const created = await request('/api/modules', 'POST', payload);
    assert.equal(created.status, 200);
    assert.equal(created.data.module.created_by, null);
    const mid = created.data.id;
    const beforeRename=(await request('/api/points?module_id='+mid)).data.items;
    assert.equal((await request('/api/modules/'+mid,'PUT',{module_no:'renamed-module'})).status,200);
    const afterRename=(await request('/api/points?module_id='+mid)).data.items;
    assert.deepEqual(afterRename.map(p=>p.id),beforeRename.map(p=>p.id));
    assert.ok(afterRename.every(p=>p.plc_point.includes(':renamed-module:')));
    const renameConflict=await request('/api/modules','POST',{...payload,module_no:'rename-conflict'});
    assert.equal((await request('/api/modules/'+mid,'PUT',{module_no:'rename-conflict'})).status,409);
    await request('/api/modules/'+renameConflict.data.id,'DELETE');
    assert.equal((await request('/api/modules/'+mid,'PUT',{module_no:'   '})).status,400);
    assert.equal((await request('/api/modules/'+mid,'PUT',{module_no:'guest-test'})).status,200);
    const otherModel = config.module_models.find(m => m.module_type_id !== model.module_type_id);
    for (const duplicatePayload of [payload, { ...payload, module_type_id: otherModel.module_type_id, module_model_id: otherModel.id }, { ...payload, module_no: ' guest-test ' }]) {
      const duplicate = await request('/api/modules', 'POST', duplicatePayload);
      assert.equal(duplicate.status, 409);
      assert.match(duplicate.data.error, /模块号.*已存在/);
    }
    for (const differentScope of [{ cabinet_id: config.cabinets[1].id }, { project_id: config.projects[1].id }]) {
      const allowed = await request('/api/modules', 'POST', { ...payload, ...differentScope });
      assert.equal(allowed.status, 200);
      await request(`/api/modules/${allowed.data.id}`, 'DELETE');
    }
    const simultaneous = await Promise.all([request('/api/modules', 'POST', { ...payload, module_no: 'race-number' }), request('/api/modules', 'POST', { ...payload, module_no: 'race-number' })]);
    assert.deepEqual(simultaneous.map(result => result.status).sort(), [200, 409]);
    await request(`/api/modules/${simultaneous.find(result => result.status === 200).data.id}`, 'DELETE');
    const storageCheck = spawnSync(process.execPath, ['-e', `
      const assert=require('node:assert/strict'); const {db}=require('./db');
      assert.throws(()=>db.prepare('INSERT INTO modules (project_id,cabinet_id,module_no,module_type_id,module_model_id,created_at) SELECT project_id,cabinet_id,module_no,module_type_id,module_model_id,created_at FROM modules WHERE id=?').run(${mid}), /柜子内模块号不能重复/);
      db.close();
    `], { cwd: path.join(__dirname, '..'), env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8' });
    assert.equal(storageCheck.status, 0, storageCheck.stderr);
    const points = (await request(`/api/points?module_id=${mid}`)).data.items;
    assert.ok(points.length > 0);
    const draftPayload = points.map((point, index) => ({ id: point.id, part: point.part,
      point_name: index === 0 ? 'BATCH_SAVE' : point.point_name,
      signal_type_id: point.signal_type_id, sort_order: point.sort_order }));
    const savedPoints = await request(`/api/modules/${mid}/points`, 'PUT', { points: draftPayload });
    assert.equal(savedPoints.status, 200, errors);
    assert.equal(savedPoints.data.items[0].point_name, 'BATCH_SAVE');
    const invalidBatch = await request(`/api/modules/${mid}/points`, 'PUT', { points: [draftPayload[0], draftPayload[0]] });
    assert.equal(invalidBatch.status, 400);
    assert.equal((await request(`/api/points?module_id=${mid}`)).data.items[0].point_name, 'BATCH_SAVE', 'invalid batch must not partially update');
    assert.equal((await request(`/api/points/${points[0].id}`, 'PATCH', { point_name: 'guest-edit' })).status, 200);
    assert.equal((await request('/api/points/bulk-part', 'POST', { module_id: mid, part: 'B' })).status, 200);
    assert.equal((await request(`/api/modules/${mid}`, 'PUT', { note: 'guest note' })).status, 200);
    assert.equal((await request(`/api/points/${points[0].id}`, 'DELETE')).status, 200);
    const user = await request('/api/auth/login', 'POST', { username: 'user', password: 'user123' });
    assert.equal(user.status, 200);
    assert.equal((await request('/api/config/projects', 'POST', { name: 'blocked' }, user.cookie)).status, 403);
    const owned = await request('/api/modules', 'POST', { ...payload, module_no: 'owned-test' }, user.cookie);
    assert.equal(owned.status, 200);
    const ownedPoints = (await request(`/api/points?module_id=${owned.data.id}`)).data.items;
    const tree = (await request('/api/tree')).data.projects;
    const ownedNode = tree.flatMap(p => p.cabinets.flatMap(c => c.modules)).find(m => m.id === owned.data.id);
    assert.equal(ownedNode.can_manage, true);
    const newPoint = await request('/api/points', 'POST', { module_id: owned.data.id });
    assert.equal(newPoint.status, 200);
    const afterAdd = (await request(`/api/points?module_id=${owned.data.id}`)).data.items;
    assert.equal(afterAdd.length, ownedPoints.length + 1);
    const addedRow = afterAdd.find(p => p.id === newPoint.data.id);
    assert.equal(addedRow.module_id, owned.data.id);
    assert.equal(addedRow.project_id, payload.project_id);
    assert.ok(addedRow.plc_point);
    assert.equal((await request('/api/points', 'POST', { module_id: 999999 })).status, 404);
    assert.equal((await request('/api/points', 'POST', { module_id: owned.data.id, project_id: 999999 })).status, 400);
    assert.equal((await request('/api/points', 'POST', { module_id: owned.data.id, signal_type_id: 999999 })).status, 400);
    assert.equal((await request(`/api/points/${ownedPoints[0].id}`, 'DELETE')).status, 200);
    assert.equal((await request(`/api/modules/${owned.data.id}`, 'DELETE')).status, 200);
    assert.equal((await request(`/api/points?module_id=${owned.data.id}`)).data.items.length, 0);
    assert.equal((await request(`/api/modules/${mid}`, 'DELETE')).status, 200);
    const admin = await request('/api/auth/login', 'POST', { username: 'admin', password: 'admin123' });
    assert.equal(admin.status, 200);
    const orderedProjects = (await request('/api/config')).data.projects.map(p => p.id);
    assert.equal((await request('/api/config/projects/reorder', 'POST', { ids: orderedProjects })).status, 401);
    assert.equal((await request('/api/config/projects/reorder', 'POST', { ids: orderedProjects }, user.cookie)).status, 403);
    assert.equal((await request('/api/config/projects/reorder', 'POST', { ids: [orderedProjects[0], orderedProjects[0]] }, admin.cookie)).status, 400);
    assert.equal((await request('/api/config/projects/reorder', 'POST', { ids: orderedProjects.slice(1) }, admin.cookie)).status, 409);
    const reversedProjects = [...orderedProjects].reverse();
    assert.equal((await request('/api/config/projects/reorder', 'POST', { ids: reversedProjects }, admin.cookie)).status, 200);
    assert.deepEqual((await request('/api/config')).data.projects.map(p => p.id), reversedProjects);
    assert.deepEqual((await request('/api/tree')).data.projects.map(p => p.id), reversedProjects);
    const orderedSignals = (await request('/api/signal-types')).data.items.map(signal => signal.id);
    assert.equal((await request('/api/signal-types/reorder', 'POST', { ids: orderedSignals })).status, 401);
    assert.equal((await request('/api/signal-types/reorder', 'POST', { ids: orderedSignals }, user.cookie)).status, 403);
    assert.equal((await request('/api/signal-types/reorder', 'POST', { ids: [orderedSignals[0], orderedSignals[0]] }, admin.cookie)).status, 400);
    assert.equal((await request('/api/signal-types/reorder', 'POST', { ids: orderedSignals.slice(1) }, admin.cookie)).status, 409);
    const reversedSignals = [...orderedSignals].reverse();
    assert.equal((await request('/api/signal-types/reorder', 'POST', { ids: reversedSignals }, admin.cookie)).status, 200);
    assert.deepEqual((await request('/api/signal-types')).data.items.map(signal => signal.id), reversedSignals);
    assert.equal((await request('/api/signal-types/reorder', 'POST', { ids: orderedSignals }, admin.cookie)).status, 200);
    assert.deepEqual((await request('/api/signal-types')).data.items.map(signal => signal.id), orderedSignals);
    assert.equal((await request('/api/config/projects', 'POST', { name: 'admin-test' }, admin.cookie)).status, 200);
    assert.equal((await request('/api/users', 'GET', undefined, admin.cookie)).status, 200);
    const motorSignal = await request('/api/signal-types', 'POST', {
      name: 'motor-filter-test', abbr: 'MOTOR', sensor_type: 'motor sensor', part_id: motorPart.id, program_name: 'Motor_Control',
    }, admin.cookie);
    assert.equal(motorSignal.status, 200);
    assert.equal((await request('/api/signal-types')).data.items.find(s => s.id === motorSignal.data.id).program_name, 'Motor_Control');
    await request(`/api/signal-types/${motorSignal.data.id}`, 'PUT', { program_name: 'Motor_Control_Updated' }, admin.cookie);
    await request(`/api/signal-types/${motorSignal.data.id}`, 'PUT', { sensor_type: 'changed sensor' }, admin.cookie);
    assert.equal((await request('/api/signal-types')).data.items.find(s => s.id === motorSignal.data.id).program_name, 'Motor_Control_Updated');
    for (const typeName of ['DI', 'DO', 'AI', 'AO']) {
      await request(`/api/signal-types/${motorSignal.data.id}`, 'PUT', { name: `motor-${typeName}` }, admin.cookie);
      const type = config.module_types.find(t => t.name === typeName);
      const expressionModel = config.module_models.find(m => m.module_type_id === type.id);
      const expressionModule = await request('/api/modules', 'POST', { ...payload, module_no: `expr-${typeName}`, module_type_id: type.id, module_model_id: expressionModel.id });
      assert.equal(expressionModule.status, 200);
      const expressionPoint = (await request(`/api/points?module_id=${expressionModule.data.id}`)).data.items[0];
      const address = expressionPoint.plc_point;
      const displayAddress = address.replace(/:Q(?=W?\.)/g, ':O');
      const spareExpression = typeName === 'DI' ? `//Spare:=${displayAddress};` : typeName === 'DO' ? `//${displayAddress}:=Spare;` : displayAddress;
      assert.equal(expressionPoint.plc_expression, spareExpression);
      if (['DI', 'DO'].includes(typeName)) {
        const wrongSignal = await request('/api/signal-types', 'POST', { name: `wrong-${typeName === 'DI' ? 'DO' : 'DI'}`, part_id: motorPart.id }, admin.cookie);
        const invalid = await request(`/api/points/${expressionPoint.id}`, 'PATCH', { part: motorPart.param, signal_type_id: wrongSignal.data.id });
        assert.equal(invalid.status, 400);
        assert.match(invalid.data.error, new RegExp(`以 ${typeName} 结尾`));
        assert.equal((await request('/api/points', 'POST', { module_id: expressionModule.data.id, part: motorPart.param, signal_type_id: wrongSignal.data.id })).status, 400);
        await request(`/api/signal-types/${wrongSignal.data.id}`, 'DELETE', undefined, admin.cookie);
      }
      const assigned = await request(`/api/points/${expressionPoint.id}`, 'PATCH', { part: motorPart.param, point_name: 'E13', signal_type_id: motorSignal.data.id });
      const expected = ['DI', 'AI'].includes(typeName) ? `Motor_Control_Updated_E00013:=${displayAddress};` : `${displayAddress}:=Motor_Control_Updated_E00013;`;
      assert.equal(assigned.data.row.plc_expression, expected);
      assert.equal(assigned.data.row.point_name, 'E13');
      assert.equal(assigned.data.row.plc_point, address);
      assert.ok((await request(`/api/export?module_id=${expressionModule.data.id}`)).data.includes(expected));
      const emptyPoint = await request(`/api/points/${expressionPoint.id}`, 'PATCH', { point_name: '   ' });
      assert.equal(emptyPoint.data.row.plc_expression, spareExpression);
      assert.ok((await request(`/api/export?module_id=${expressionModule.data.id}`)).data.includes(spareExpression));
      const changed = await request(`/api/points/${expressionPoint.id}`, 'PATCH', { point_name: 'E14' });
      assert.equal(changed.data.row.plc_expression, expected.replace('E00013', 'E00014'));
      for (const [pointName, formattedPoint] of [['G6', 'G00006'], ['g6', 'G00006'], ['p1032', 'P01032'], ['P1032', 'P01032'], ['G00006', 'G00006'], ['P123456', 'P123456'], ['custom-point', 'CUSTOM-POINT']]) {
        const formatted = await request(`/api/points/${expressionPoint.id}`, 'PATCH', { point_name: pointName });
        assert.equal(formatted.data.row.point_name, pointName.toUpperCase());
        assert.equal(formatted.data.row.plc_expression, expected.replace('E00013', formattedPoint));
        assert.ok((await request(`/api/export?module_id=${expressionModule.data.id}`)).data.includes(expected.replace('E00013', formattedPoint)));
      }
      const cleared = await request(`/api/points/${expressionPoint.id}`, 'PATCH', { signal_type_id: null });
      assert.equal(cleared.data.row.plc_expression, spareExpression);
      assert.ok((await request(`/api/export?module_id=${expressionModule.data.id}`)).data.includes(spareExpression));
      await request(`/api/modules/${expressionModule.data.id}`, 'DELETE');
    }
    assert.equal((await request('/api/signal-types', 'POST', { name: 'missing-part' }, admin.cookie)).status, 400);
    await request(`/api/signal-types/${motorSignal.data.id}`, 'PUT', { name: 'motor-DI' }, admin.cookie);
    await request(`/api/signal-types/${signals[0].id}`, 'PUT', { name: `${signals[0].name}DI` }, admin.cookie);
    assert.equal((await request(`/api/signal-types/${motorSignal.data.id}`, 'PUT', { part_id: 999999 }, admin.cookie)).status, 400);
    assert.equal((await request(`/api/config/parts/${motorPart.id}`, 'DELETE', undefined, admin.cookie)).status, 409);
    const filterModule = await request('/api/modules', 'POST', { ...payload, module_no: 'filter-test' });
    const filterId = filterModule.data.id;
    const filterPoint = (await request(`/api/points?module_id=${filterId}`)).data.items[0];
    assert.equal((await request(`/api/points/${filterPoint.id}`, 'PATCH', { part: fieldPart.param, signal_type_id: signals[0].id })).status, 200);
    const switched = await request(`/api/points/${filterPoint.id}`, 'PATCH', { part: motorPart.param });
    assert.equal(switched.status, 200);
    assert.equal(switched.data.row.signal_type_id, null);
    assert.equal(switched.data.row.code, 'Reserved');
    assert.equal((await request(`/api/points/${filterPoint.id}`, 'PATCH', { signal_type_id: signals[0].id })).status, 400);
    assert.equal((await request(`/api/points/${filterPoint.id}`, 'PATCH', { signal_type_id: motorSignal.data.id })).status, 200);
    await request('/api/points/bulk-part', 'POST', { module_id: filterId, part: fieldPart.param });
    assert.equal((await request(`/api/points?module_id=${filterId}`)).data.items.find(p => p.id === filterPoint.id).signal_type_id, null);
    assert.equal((await request('/api/points', 'POST', { module_id: filterId, part: fieldPart.param, signal_type_id: motorSignal.data.id })).status, 400);
    assert.equal((await request('/api/points', 'POST', { module_id: filterId, part: motorPart.param, signal_type_id: motorSignal.data.id })).status, 200);
    assert.equal((await request(`/api/signal-types/${signals[0].id}`, 'PUT', { part_id: motorPart.id }, admin.cookie)).status, 200);
    const reopened = spawnSync(process.execPath, ['-e',
      `const {db}=require('./db');console.log(db.prepare('SELECT part_id FROM signal_types WHERE id=?').get(${signals[0].id}).part_id);db.close();`], {
      cwd: path.join(__dirname, '..'), env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8',
    });
    assert.equal(reopened.status, 0, reopened.stderr);
    assert.equal(Number(reopened.stdout.trim()), motorPart.id, '重新初始化数据库不会覆盖已修改的所属部位');
    await request('/api/auth/logout', 'POST', undefined, admin.cookie);
    assert.equal((await request('/api/users', 'GET', undefined, admin.cookie)).status, 401);
    assert.equal((await request('/api/tree')).status, 200);
  } finally {
    app.kill();
    await once(app, 'exit');
    const resolved = path.resolve(dataDir);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('spt-access-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
