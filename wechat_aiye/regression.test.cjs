const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let ts;
try { ts = require(process.env.AIYE_TYPESCRIPT_PATH || 'typescript'); }
catch {
  ts = require('/Applications/Trae.app/Contents/Resources/app/extensions/node_modules/typescript/lib/typescript.js');
}

const storage = new Map();
let requestHandler = async () => { throw new Error('Unexpected test request'); };
let uploadHandler = async () => { throw new Error('Unexpected test upload'); };
const taro = {
  getStorageSync: key => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: key => storage.delete(key),
  eventCenter: { trigger() {}, on() {}, off() {} },
  request: options => requestHandler(options),
  uploadFile: options => uploadHandler(options),
  navigateTo: async () => {},
};
const cache = new Map();
const load = name => {
  const filename = path.resolve(__dirname, name);
  if (cache.has(filename)) return cache.get(filename);
  const module = { exports: {} };
  cache.set(filename, module.exports);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const requireSource = id => {
    if (id === '@tarojs/taro') return taro;
    if (id === 'react') return {};
    const resolved = id.startsWith('@/') ? path.join(__dirname, 'src', id.slice(2))
      : id.startsWith('.') ? path.resolve(path.dirname(filename), id) : null;
    return resolved ? load(`${resolved}.ts`) : require(id);
  };
  new Function('require', 'module', 'exports', 'process', source)(
    requireSource, module, module.exports, { env: { TARO_APP_API_BASE_URL: 'https://api.test', TARO_ENV: 'weapp' } },
  );
  cache.set(filename, module.exports);
  return module.exports;
};
const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };
const response = (data, statusCode = 200) => ({ statusCode, data });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

(async () => {
  const catalog = load('src/utils/catalog.ts');
  const booking = load('src/utils/booking.ts');
  const pricing = load('src/utils/pricing.ts');
  const publication = load('src/utils/publication.ts');
  const session = load('src/store/session.ts');
  const activity = load('src/store/activity.ts');
  const api = load('src/services/api.ts');
  check('city-only location', () => assert.equal(catalog.cityLocation('海南省三亚市海棠区某酒店'), '海南省三亚市'));
  check('municipality location', () => assert.equal(catalog.cityLocation('北京市朝阳区'), '北京市'));
  check('legacy geographic payload hidden', () => assert.equal(catalog.displayLocation('三亚|||PEIPEI_GEO1|||{"points":[[18,109]]}'), '三亚'));
  check('positive rating precision', () => assert.equal(catalog.ratingText(4.567), '★ 4.57分'));
  check('zero rating hidden', () => assert.equal(catalog.ratingText(0), ''));
  check('photo fees align with Android taxonomy', () => assert.ok(publication.publicationOptions('摄影').fees.includes('加急修图费')));
  check('category change removes incompatible tags', () => assert.deepEqual(publication.normalizePublicationTags(['审美在线', '忌口可调'],
    publication.publicationOptions('私厨').features), ['忌口可调']));
  check('priority before featured flag', () => assert.deepEqual(catalog.sortCatalog([
    { id: 'recent', updated_at: 30 }, { id: 'featured', updated_at: 1, is_important: true },
    { id: 'priority', updated_at: 0, sort_priority: 2 },
  ]).map(item => item.id), ['priority', 'featured', 'recent']));
  check('invalid time range ignored', () => assert.deepEqual(booking.decodeRanges('[{"start":"99:00","end":"24:00"}]'), []));
  check('malformed time data handled', () => assert.deepEqual(booking.decodeRanges('{broken'), []));
  check('midnight end supported', () => assert.equal(booking.clockMinutes('24:00'), 1440));
  const now = new Date(2026, 10, 14, 9, 10);
  const rules = { booking_lead_hours: 1, booking_future_open_days: 7, booking_time_ranges_json: '[{"start":"08:00","end":"12:00"}]' };
  check('lead hours filter half-hour slots', () => assert.deepEqual(booking.bookingDays(rules, now)[0].times, ['10:30', '11:00', '11:30']));
  check('all-day local closure', () => assert.equal(booking.bookingDays(rules, now, {
    '2026-11-14': { allDay: true, start: '', end: '' },
  })[0].key, '2026-11-15'));
  check('scheduled date uses local time', () => assert.equal(booking.scheduledMillis('2026-11-15', '10:30'), new Date(2026, 10, 15, 10, 30).getTime()));
  const tiers = [{ name: '拍摄', price: '¥200', duration_amount: 2, duration_unit: '小时' }];
  const encoded = pricing.encodePriceTiers(tiers);
  check('Android v2 price roundtrip', () => assert.deepEqual(pricing.decodePriceTiers(encoded.price_text, encoded.price_basis_text), tiers));
  check('legacy v1 duration decoded', () => assert.equal(pricing.decodePriceTiers('¥20', 'lulu_publish_tiers_v1:{"tiers":[{"duration":"30分钟"}]}')[0].duration_amount, 30));
  check('raw price JSON hidden', () => assert.equal(pricing.priceBasisLabel(encoded.price_basis_text), '以档位说明为准'));
  check('malformed duration falls back', () => assert.equal(pricing.decodePriceTiers('¥20', 'lulu_publish_tiers_v2:{"tiers":[{"duration_amount":"invalid"}]}')[0].duration_amount, 4));
  check('empty price tiers rejected', () => assert.throws(() => pricing.encodePriceTiers([])));
  check('legacy owned images use configured API', () => assert.equal(api.mediaUrl('http://192.168.43.168:8000/static/services/a.jpg'), 'https://api.test/static/services/a.jpg'));
  check('third-party static images keep origin', () => assert.equal(api.mediaUrl('https://images.test/static/a.jpg'), 'https://images.test/static/a.jpg'));
  const user = { id: 'account-a', name: 'A' };
  const item = { id: 's1', title: '服务', creator_id: user.id, creator: user.name };
  session.setSession('old', user, 'refresh');
  activity.recordView(item, 'service');
  session.setSession('other', { id: 'account-b', name: 'B' }, 'other-refresh');
  check('local history is account isolated', () => assert.equal(activity.getActivity('viewed').length, 0));
  session.setSession('old', user, 'refresh');
  check('switching back restores local history', () => assert.equal(activity.getActivity('viewed')[0].item_id, 's1'));

  let refreshCount = 0;
  requestHandler = async options => {
    if (options.url.endsWith('/auth/refresh')) {
      refreshCount++;
      await Promise.resolve();
      return response({ access_token: 'new', refresh_token: 'new-refresh' });
    }
    return options.header.Authorization === 'Bearer old' ? response({}, 401) : response({ ok: true });
  };
  const results = await Promise.all([api.request('/one'), api.request('/two'), api.request('/three')]);
  check('concurrent 401 refresh is single-flight', () => assert.equal(refreshCount, 1));
  check('all expired requests retry', () => assert.ok(results.every(result => result.ok)));
  check('rotated refresh token persisted', () => assert.equal(session.getSession().refreshToken, 'new-refresh'));
  session.setSession('old', user, 'refresh');
  uploadHandler = async options => options.header.Authorization === 'Bearer old'
    ? response('{}', 401) : response('{"url":"/static/upload.jpg"}');
  const uploaded = await api.upload('/tmp/test-image.jpg', 'chat');
  check('uploads refresh expired sessions', () => assert.equal(uploaded.url, '/static/upload.jpg'));

  const waiting = deferred();
  requestHandler = () => waiting.promise;
  const oldRequest = api.request('/private');
  session.setSession('account-b-token', { id: 'account-b', name: 'B' }, 'b-refresh');
  waiting.resolve(response({ private: 'old account' }));
  await assert.rejects(oldRequest, error => error.status === 409);
  checks.push('old account response cannot populate new account');
  let profile = { service_ids: [], groups: [] };
  requestHandler = async options => {
    if (options.method === 'PUT') profile = JSON.parse(JSON.stringify(options.data));
    return response(JSON.parse(JSON.stringify(profile)));
  };
  await Promise.all([api.toggleFavorite('service', 'one'), api.toggleFavorite('service', 'two')]);
  check('parallel favorites preserve both updates', () => assert.deepEqual(profile.service_ids, ['one', 'two']));
  requestHandler = async options => options.url.includes('before=100')
    ? response([{ created_at: 1, sender_id: 'starter' }])
    : response(Array.from({ length: 500 }, (_, index) => ({ created_at: 100 + index, sender_id: 'recent' })));
  const starter = await api.getConversationStarter('conversation');
  check('inquiry classification reads earlier pages', () => assert.equal(starter, 'starter'));
  const logoutWait = deferred();
  requestHandler = () => logoutWait.promise;
  const loggingOut = api.logoutRemote();
  session.setSession('replacement-token', { id: 'replacement-user' }, 'replacement-refresh');
  logoutWait.resolve(response({}));
  await assert.rejects(loggingOut, error => error.status === 409);
  check('old logout cannot clear replacement login', () => assert.equal(session.getSession().token, 'replacement-token'));
  let createAttempts = 0;
  let updateAttempts = 0;
  requestHandler = async options => {
    if (options.method === 'POST') { createAttempts++; throw new Error('Response lost after server commit'); }
    if (options.method === 'PUT') { updateAttempts++; return response(options.data); }
    return response({ id: 'stable-id', creator_id: 'replacement-user', title: 'existing' });
  };
  const recovered = await api.saveItem('service', { id: 'stable-id', creator_id: 'replacement-user', title: 'new title' }, false);
  check('lost publication response reuses stable item', () => {
    assert.equal(recovered.id, 'stable-id'); assert.equal(createAttempts, 1); assert.equal(updateAttempts, 1);
  });
  console.log(`PASS: ${checks.length} miniapp regression checks; no real API or account data used`);
})().catch(error => { console.error(error); process.exitCode = 1; });
