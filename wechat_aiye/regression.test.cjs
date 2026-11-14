const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let ts;
try { ts = require(process.env.AIYE_TYPESCRIPT_PATH || 'typescript'); }
catch {
  ts = require('/Applications/Trae.app/Contents/Resources/app/extensions/node_modules/typescript/lib/typescript.js');
}

const storage = new Map();
const listeners = new Map();
const toasts = [];
const navigations = [];
let backHandler = async () => {};
const readyUser = { id: 'ready-user', name: 'User', gender: '女', region: '北京', photo_url: '/static/avatar.jpg',
  phone_number: '13800138000', is_phone_verified: true, is_profile_completed: false };
const nextTicks = [];
const nodeQueries = [];
let timers = { setTimeout, clearTimeout };
let intervals = { setInterval, clearInterval };
let routerParams = {};
let imagePicker = async () => { throw new Error('Unexpected image picker'); };
let locationPicker = async () => { throw new Error('Unexpected location picker'); };
const sockets = [];
const keyboardListeners = new Set();
let requestHandler = async () => { throw new Error('Unexpected test request'); };
let uploadHandler = async () => { throw new Error('Unexpected test upload'); };
const taro = {
  getStorageSync: key => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: key => storage.delete(key),
  eventCenter: {
    trigger: event => { for (const listener of listeners.get(event) || []) listener(); },
    on: (event, listener) => { listeners.set(event, [...(listeners.get(event) || []), listener]); },
    off: (event, listener) => { listeners.set(event, (listeners.get(event) || []).filter(value => value !== listener)); },
  },
  request: options => requestHandler(options),
  getCurrentInstance: () => ({ router: { params: routerParams } }),
  getSystemInfoSync: () => ({ windowHeight: 800 }),
  setNavigationBarTitle: async () => {},
  onKeyboardHeightChange: callback => { keyboardListeners.add(callback); },
  offKeyboardHeightChange: callback => { keyboardListeners.delete(callback); },
  chooseImage: options => imagePicker(options),
  chooseLocation: options => locationPicker(options),
  connectSocket: async () => {
    const socket = { closes: 0, onMessage(callback) { socket.message = callback; }, onError() {},
      async close() { socket.closes++; } };
    sockets.push(socket);
    return socket;
  },
  uploadFile: options => uploadHandler(options),
  navigateTo: async options => { navigations.push(`open:${options.url}`); },
  redirectTo: async options => { navigations.push(`redirect:${options.url}`); },
  navigateBack: async () => { await backHandler(); navigations.push('back'); },
  switchTab: async options => { navigations.push(`tab:${options.url}`); },
  showToast: async options => { toasts.push(options.title); },
  usePullDownRefresh() {},
  useDidShow: callback => { rendering.lifecycle.show = callback; },
  useDidHide: callback => { rendering.lifecycle.hide = callback; },
  useResize: callback => { rendering.lifecycle.resize = callback; },
  nextTick: callback => { nextTicks.push(callback); },
  createSelectorQuery() {
    const query = {
      select(selector) {
        query.rootSelector = selector;
        return { boundingClientRect(callback) { query.rootCallback = callback; return query; } };
      },
      selectAll(selector) {
        query.cardSelector = selector;
        return { boundingClientRect(callback) { query.cardCallback = callback; return query; } };
      },
      exec(callback) { query.callback = callback; nodeQueries.push(query); },
    };
    return query;
  },
  pxTransform: value => `${value}px`,
};
let rendering;
const sameDependencies = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useState(initial) {
    const instance = rendering;
    const index = instance.cursor++;
    if (!(index in instance.slots)) instance.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [instance.slots[index], value => {
      instance.slots[index] = typeof value === 'function' ? value(instance.slots[index]) : value;
    }];
  },
  useRef(initial) {
    const index = rendering.cursor++;
    return rendering.slots[index] || (rendering.slots[index] = { current: initial });
  },
  useCallback(callback, dependencies) {
    const index = rendering.cursor++;
    const previous = rendering.slots[index];
    if (!previous || !sameDependencies(previous.dependencies, dependencies)) {
      rendering.slots[index] = { dependencies, callback };
    }
    return rendering.slots[index].callback;
  },
  useMemo(factory, dependencies) {
    const index = rendering.cursor++;
    const previous = rendering.slots[index];
    if (!previous || !sameDependencies(previous.dependencies, dependencies)) {
      rendering.slots[index] = { dependencies, value: factory() };
    }
    return rendering.slots[index].value;
  },
  useEffect(effect, dependencies) {
    const instance = rendering;
    const index = instance.cursor++;
    const previous = instance.slots[index];
    if (!previous || !sameDependencies(previous.dependencies, dependencies)) {
      instance.effects.push(() => {
        previous?.cleanup?.();
        instance.slots[index] = { dependencies, cleanup: effect() };
      });
    }
  },
};
const createRenderer = component => {
  const instance = { cursor: 0, slots: [], effects: [], lifecycle: {} };
  return {
    render(props) {
      instance.cursor = 0;
      rendering = instance;
      const result = component(props);
      rendering = undefined;
      for (const effect of instance.effects.splice(0)) effect();
      return result;
    },
    show() { instance.lifecycle.show?.(); },
    hide() { instance.lifecycle.hide?.(); },
    resize() { instance.lifecycle.resize?.(); },
    unmount() { for (const slot of instance.slots) slot?.cleanup?.(); },
  };
};
const cache = new Map();
const load = name => {
  const filename = path.resolve(__dirname, name);
  if (cache.has(filename)) return cache.get(filename);
  const module = { exports: {} };
  cache.set(filename, module.exports);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true, jsx: ts.JsxEmit.React },
  }).outputText;
  const requireSource = id => {
    if (id === '@tarojs/taro') return taro;
    if (id === 'react') return react;
    if (id === '@tarojs/components') return { View: 'View', Text: 'Text', Image: 'Image', Input: 'Input', Checkbox: 'Checkbox', ScrollView: 'ScrollView' };
    if (id === 'classnames') return (...values) => values.filter(Boolean).join(' ');
    if (id.endsWith('.scss')) return new Proxy({}, { get: (_, property) => property === '__esModule' ? false : property });
    const resolved = id.startsWith('@/') ? path.join(__dirname, 'src', id.slice(2))
      : id.startsWith('.') ? path.resolve(path.dirname(filename), id) : null;
    if (!resolved) return require(id);
    return load([`${resolved}.ts`, `${resolved}.tsx`, path.join(resolved, 'index.tsx')].find(fs.existsSync));
  };
  new Function('require', 'module', 'exports', 'process', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', source)(
    requireSource, module, module.exports, { env: { TARO_APP_API_BASE_URL: 'https://api.test', TARO_ENV: 'weapp' } },
    (...args) => timers.setTimeout(...args), (...args) => timers.clearTimeout(...args),
    (...args) => intervals.setInterval(...args), (...args) => intervals.clearInterval(...args),
  );
  cache.set(filename, module.exports);
  return module.exports;
};
const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };
const response = (data, statusCode = 200) => ({ statusCode, data });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

(async () => {
  const catalog = load('src/utils/catalog.ts');
  const booking = load('src/utils/booking.ts');
  const pricing = load('src/utils/pricing.ts');
  const publication = load('src/utils/publication.ts');
  const masonry = load('src/utils/masonry.ts');
  const session = load('src/store/session.ts');
  const activity = load('src/store/activity.ts');
  const api = load('src/services/api.ts');
  check('Vite HTML entry marker matches official transform', () => assert.match(
    fs.readFileSync(path.join(__dirname, 'src/index.html'), 'utf8'),
    /<script><%= htmlWebpackPlugin.options.script %><\/script>/,
  ));
  check('Babel uses the configured Vite compiler', () => assert.equal(require('./babel.config.js').presets[0][1].compiler, 'vite'));
  check('city-only location', () => assert.equal(catalog.cityLocation('海南省三亚市海棠区某酒店'), '海南省三亚市'));
  check('municipality location', () => assert.equal(catalog.cityLocation('北京市朝阳区'), '北京市'));
  check('legacy geographic payload hidden', () => assert.equal(catalog.displayLocation('三亚|||PEIPEI_GEO1|||{"points":[[18,109]]}'), '三亚'));
  check('positive rating precision', () => assert.equal(catalog.ratingText(4.567), '★ 4.57分'));
  check('zero rating hidden', () => assert.equal(catalog.ratingText(0), ''));
  check('legacy home experience categories remain valid service groups', () => assert.equal(catalog.normalizeServiceCategory(' 夜生活 '), '夜生活'));
  check('non-home experience fallback is not a service category', () => assert.equal(catalog.normalizeServiceCategory('其他体验'), '其他服务'));
  check('photo fees align with Android taxonomy', () => assert.ok(publication.publicationOptions('摄影').fees.includes('加急修图费')));
  check('photo title hint matches Android category', () => assert.equal(publication.publicationHints('摄影').titlePlaceholder, '例如：三亚海边旅拍｜精修 9 张'));
  check('chef description explains procurement and cleaning', () => assert.match(publication.publicationHints('私厨').descriptionPlaceholder, /采购.*餐后清洁/));
  check('unknown category uses the Android generic hint', () => assert.equal(publication.publicationHints('invalid').titlePlaceholder, '用一句话概括你的服务'));
  check('category change removes incompatible tags', () => assert.deepEqual(publication.normalizePublicationTags(['审美在线', '忌口可调'],
    publication.publicationOptions('私厨').features), ['忌口可调']));
  const images = ['cover', 'second', 'third'];
  check('moving an image preserves all other image order', () => assert.deepEqual(publication.movePublicationImage(images, 2, 0), ['third', 'cover', 'second']));
  check('image reorder does not mutate the draft snapshot', () => assert.deepEqual(images, ['cover', 'second', 'third']));
  check('invalid image positions leave the order unchanged', () => assert.deepEqual(publication.movePublicationImage(images, -1, 2), images));
  check('priority before featured flag', () => assert.deepEqual(catalog.sortCatalog([
    { id: 'recent', updated_at: 30 }, { id: 'featured', updated_at: 1, is_important: true },
    { id: 'priority', updated_at: 0, sort_priority: 2 },
  ]).map(item => item.id), ['priority', 'featured', 'recent']));
  check('service cover heights follow Android hash sequence', () => assert.deepEqual(['a', 'b', 'c', 'd'].map(catalog.homeServiceCoverHeight), [384, 432, 476, 336]));
  check('Chinese IDs use Java UTF-16 string hashing', () => assert.equal(catalog.homeServiceCoverHeight('拍摄'), 476));
  check('minimum signed hash has a valid cover height', () => assert.equal(catalog.homeServiceCoverHeight('polygenelubricants'), 336));
  const experiences = [
    { id: 'old', category: '夜生活', updated_at: 1, created_at: 10, sort_priority: 100 },
    { id: 'new', category: '夜生活', updated_at: 20, created_at: 20 },
    { id: 'tie', category: '夜生活', updated_at: 20, created_at: 30 },
    { id: 'classic', category: '必游经典景区', updated_at: 3, created_at: 3 },
    { id: 'water', category: '海面运动', updated_at: 2, created_at: 2 },
  ];
  const sections = catalog.experienceSections(experiences);
  check('experience category ordering matches Android code-unit sorting', () => assert.deepEqual(sections.map(([name]) => name), ['夜生活', '必游经典景区', '海面运动']));
  check('experience cards order by update then creation, not service priority', () => assert.deepEqual(sections[0][1].map(value => value.id), ['tie', 'new', 'old']));
  check('experience grouping does not mutate API data', () => assert.equal(experiences[0].id, 'old'));
  const gridIds = ['a', 'b', 'c', 'd'];
  const gridSizes = [100, 20, 20, 150].map(height => ({ width: 100, height }));
  const grid = masonry.layoutMeasuredCards(gridIds, 210, gridSizes);
  check('masonry fills the shorter measured column instead of alternating', () => assert.deepEqual(
    grid.positions.map(({ id, left, top }) => [id, left, top]),
    [['a', 0, 0], ['b', 110, 0], ['c', 110, 30], ['d', 110, 60]],
  ));
  check('masonry container encloses both columns without trailing gap', () => assert.equal(grid.height, 210));
  check('equal columns fill left first', () => assert.equal(masonry.layoutMeasuredCards(['a', 'b', 'c'], 210,
    [40, 40, 30].map(height => ({ width: 100, height }))).positions[2].left, 0));
  const prefixGrid = masonry.layoutMeasuredCards(gridIds.slice(0, 3), 210, gridSizes.slice(0, 3));
  check('appending cards preserves all measured prefix positions', () => assert.deepEqual(grid.positions.slice(0, 3), prefixGrid.positions));
  check('missing node measurements cannot position partial data', () => assert.equal(masonry.layoutMeasuredCards(gridIds, 210, gridSizes.slice(1)), null));
  check('zero-size hidden nodes cannot produce overlapping cards', () => assert.equal(masonry.layoutMeasuredCards(['a'], 210, [{ width: 100, height: 0 }]), null));
  check('inconsistent card widths require new measurement', () => assert.equal(masonry.layoutMeasuredCards(['a', 'b'], 210,
    [{ width: 100, height: 50 }, { width: 110, height: 50 }]), null));
  check('duplicate IDs are not used as layout identities', () => assert.equal(masonry.layoutMeasuredCards(['a', 'a'], 210, gridSizes.slice(0, 2)), null));
  check('invalid container width is rejected', () => assert.equal(masonry.layoutMeasuredCards(['a'], NaN, gridSizes.slice(0, 1)), null));
  check('empty masonry has no reserved height', () => assert.deepEqual(masonry.layoutMeasuredCards([], 0, []), { positions: [], height: 0 }));
  check('new widths use newly measured gaps', () => assert.equal(masonry.layoutMeasuredCards(['a', 'b'], 320,
    [{ width: 150, height: 50 }, { width: 150, height: 50 }]).positions[1].left, 170));
  check('unchanged appended cards retain the old layout prefix', () => assert.equal(masonry.sameMasonryPrefix(['a', 'b'], ['a', 'b', 'c']), true));
  check('reordered cards cannot reuse old positions', () => assert.equal(masonry.sameMasonryPrefix(['a', 'b'], ['b', 'a']), false));
  check('changed title or price invalidates prefix positions', () => assert.equal(masonry.sameMasonryPrefix(['a:title1'], ['a:title2', 'b']), false));
  check('removed cards cannot reuse a taller old container', () => assert.equal(masonry.sameMasonryPrefix(['a', 'b'], ['a']), false));
  check('overflowing measurements cannot generate infinite positioning', () => assert.equal(masonry.layoutMeasuredCards(['a', 'b', 'c'], 210,
    [1e308, 1e308, 1e308].map(height => ({ width: 100, height }))), null));
  const measuredNodes = [{ id: 'node-b', width: 100, height: 20 }, { id: 'node-a', width: 100, height: 100 }];
  check('measurement results are paired by node ID, not callback order', () => assert.deepEqual(
    masonry.orderMeasuredCards(['node-a', 'node-b'], measuredNodes), [measuredNodes[1], measuredNodes[0]]));
  check('foreign measurement nodes are rejected', () => assert.equal(
    masonry.orderMeasuredCards(['node-a', 'node-c'], measuredNodes), null));
  check('duplicate measurement nodes are rejected', () => assert.equal(
    masonry.orderMeasuredCards(['node-a', 'node-b'], [measuredNodes[0], measuredNodes[0]]), null));
  check('measurement nodes without IDs cannot be paired', () => assert.equal(
    masonry.orderMeasuredCards(['node-a'], [{ width: 100, height: 100 }]), null));
  check('empty measurement identity has no nodes', () => assert.deepEqual(masonry.orderMeasuredCards([], []), []));

  const HomeServiceGrid = load('src/components/HomeServiceGrid/index.tsx').default;
  const pendingTimers = new Map();
  let timerId = 0;
  timers = {
    setTimeout(callback) { pendingTimers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { pendingTimers.delete(id); },
  };
  const gridRoot = tree => tree.props.children.find(child => child?.props?.id);
  const gridCards = tree => gridRoot(tree).props.children.flat();
  const runMeasurement = () => { assert.ok(nextTicks.length); nextTicks.shift()(); return nodeQueries.shift(); };
  const answerMeasurement = (query, tree, heights, width = 210) => {
    query.rootCallback({ width });
    query.cardCallback(gridCards(tree).map((card, index) => ({
      id: card.props.id, width: (width - 10) / 2, height: heights[index],
    })).reverse());
    query.callback();
  };
  const gridProps = { items: gridIds.slice(0, 3).map(id => ({ id, title: id })), favorites: [], onFavorite() {} };
  const measuredGrid = createRenderer(HomeServiceGrid);
  let tree = measuredGrid.render(gridProps);
  const query = runMeasurement();
  check('grid measurement uses its own safe root ID', () => assert.equal(query.rootSelector, `#${gridRoot(tree).props.id}`));
  check('card query is scoped and independent of generated CSS names', () => assert.equal(
    query.cardSelector, `#${gridRoot(tree).props.id} .aiyeHomeServiceCard`));
  answerMeasurement(query, tree, [100, 20, 20]);
  tree = measuredGrid.render(gridProps);
  check('component uses ID-paired shorter-column positions', () => assert.deepEqual(
    gridCards(tree).map(card => card.props.style), [
      { left: '0px', top: '0px' }, { left: '110px', top: '0px' }, { left: '110px', top: '30px' },
    ]));
  check('successful measurement cancels its timeout', () => assert.equal(pendingTimers.size, 0));
  answerMeasurement(query, tree, [900, 900, 900]);
  tree = measuredGrid.render(gridProps);
  check('duplicate completion cannot overwrite a settled measurement', () => assert.equal(gridRoot(tree).props.style.height, '100px'));
  const previousStyles = gridCards(tree).map(card => card.props.style);
  const appendedProps = { ...gridProps, items: [...gridProps.items, { id: 'd', title: 'd' }] };
  tree = measuredGrid.render(appendedProps);
  check('pending append retains visible prefix positions', () => assert.deepEqual(
    gridCards(tree).slice(0, 3).map(card => card.props.style), previousStyles));
  check('pending append retains the old scroll container height', () => assert.equal(gridRoot(tree).props.style.height, '100px'));
  check('new card alone is hidden during append measurement', () => {
    assert.match(gridCards(tree)[3].props.className, /pending/);
    assert.ok(gridCards(tree).slice(0, 3).every(card => !card.props.className.includes('pending')));
  });
  answerMeasurement(runMeasurement(), tree, [100, 20, 20, 150]);
  tree = measuredGrid.render(appendedProps);
  check('completed append expands the container to measured height', () => assert.equal(gridRoot(tree).props.style.height, '210px'));

  const changedProps = { ...gridProps, items: [{ id: 'changed', title: 'changed' }] };
  const staleTree = measuredGrid.render(changedProps);
  const staleQuery = runMeasurement();
  const finalProps = { ...gridProps, items: [{ id: 'final', title: 'final' }] };
  tree = measuredGrid.render(finalProps);
  answerMeasurement(staleQuery, staleTree, [900]);
  tree = measuredGrid.render(finalProps);
  check('old category measurement cannot reveal the new category', () => assert.equal(gridRoot(tree).props.style, undefined));
  answerMeasurement(runMeasurement(), tree, [80]);
  tree = measuredGrid.render(finalProps);
  check('current category measurement becomes visible', () => assert.equal(gridRoot(tree).props.style.height, '80px'));
  measuredGrid.resize();
  tree = measuredGrid.render(finalProps);
  check('resize discards positions from the previous width', () => assert.equal(gridRoot(tree).props.style, undefined));
  answerMeasurement(runMeasurement(), tree, [90], 320);
  tree = measuredGrid.render(finalProps);
  check('resize applies the new measured height', () => assert.equal(gridRoot(tree).props.style.height, '90px'));
  measuredGrid.show();
  tree = measuredGrid.render(finalProps);
  const timedOutQuery = runMeasurement();
  for (const callback of [...pendingTimers.values()]) callback();
  tree = measuredGrid.render(finalProps);
  check('measurement timeout reveals a two-column fallback', () => {
    assert.equal(gridRoot(tree).props.style, undefined);
    assert.ok(!gridRoot(tree).props.className.includes('pending'));
  });
  answerMeasurement(timedOutQuery, tree, [999]);
  tree = measuredGrid.render(finalProps);
  check('late callback cannot replace timeout fallback', () => assert.equal(gridRoot(tree).props.style, undefined));
  tree.props.children.find(child => child?.props?.className === 'status').props.children[1].props.onClick();
  tree = measuredGrid.render(finalProps);
  answerMeasurement(runMeasurement(), tree, [100]);
  tree = measuredGrid.render(finalProps);
  check('retry measures and recovers the current cards', () => assert.equal(gridRoot(tree).props.style.height, '100px'));
  const otherGrid = createRenderer(HomeServiceGrid);
  const otherTree = otherGrid.render(gridProps);
  check('simultaneously mounted grids have distinct query roots', () => assert.notEqual(gridRoot(tree).props.id, gridRoot(otherTree).props.id));
  const unmountedQuery = runMeasurement();
  otherGrid.unmount();
  answerMeasurement(unmountedQuery, otherTree, [100, 20, 20]);
  check('unmount clears the measurement timeout', () => assert.equal(pendingTimers.size, 0));
  measuredGrid.unmount();
  const invalidGrid = createRenderer(HomeServiceGrid);
  tree = invalidGrid.render(gridProps);
  const rejectMeasurement = query => {
    query.rootCallback({ width: 210 });
    query.cardCallback([]);
    query.callback();
  };
  rejectMeasurement(runMeasurement());
  check('incomplete node results schedule one bounded retry', () => assert.equal(nextTicks.length, 1));
  rejectMeasurement(runMeasurement());
  tree = invalidGrid.render(gridProps);
  check('second incomplete result reveals fallback instead of waiting indefinitely', () => {
    assert.ok(!gridRoot(tree).props.className.includes('pending'));
    assert.equal(pendingTimers.size, 0);
    assert.equal(nextTicks.length, 0);
  });
  check('empty catalog removes the measured grid', () => assert.equal(invalidGrid.render({ ...gridProps, items: [] }), null));
  check('empty catalog does not leave a pending measurement timer', () => assert.equal(pendingTimers.size, 0));
  invalidGrid.unmount();
  timers = { setTimeout, clearTimeout };
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
  check('service mode follows the first price tier duration unit', () => assert.equal(encoded.service_mode, '小时'));
  const minuteTier = pricing.encodePriceTiers([{ name: '  快拍  ', price: ' ¥99 ', duration_amount: 30, duration_unit: ' 分钟 ' }]);
  check('minute tier saves minutes instead of legacy quantity units', () => assert.equal(minuteTier.service_mode, '分钟'));
  check('price tier serialization trims fields', () => assert.deepEqual(pricing.decodePriceTiers(minuteTier.price_text, minuteTier.price_basis_text),
    [{ name: '快拍', price: '¥99', duration_amount: 30, duration_unit: '分钟' }]));
  const unnamedTier = pricing.encodePriceTiers([{ name: '', price: '¥10', duration_amount: 4, duration_unit: '小时' }]);
  check('default display names are not persisted as custom names', () => assert.equal(pricing.decodePriceTiers(unnamedTier.price_text, unnamedTier.price_basis_text)[0].name, ''));
  check('legacy duration defaults to four hours', () => assert.equal(pricing.decodePriceTiers('¥10', '')[0].duration_amount, 4));
  check('fractional duration cannot be saved', () => assert.throws(() => pricing.encodePriceTiers([{ ...tiers[0], duration_amount: 1.5 }])));
  check('excessive duration cannot be saved', () => assert.throws(() => pricing.encodePriceTiers([{ ...tiers[0], duration_amount: 100000 }])));
  check('overflowing price cannot be saved', () => assert.throws(() => pricing.encodePriceTiers([{ ...tiers[0], price: '9'.repeat(309) }])));
  check('tier JSON with leading whitespace stays hidden', () => assert.equal(pricing.priceBasisLabel(` ${encoded.price_basis_text}`, '小时'), '小时'));
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
  activity.recordBooking(item, 'service', 123, 'conversation', 'same-message');
  activity.recordBooking(item, 'service', 123, 'conversation', 'same-message');
  check('inquiry retry saves one local record', () => assert.equal(activity.getActivity('booked').length, 1));
  activity.cancelBooking('inquiry:same-message');
  activity.recordBooking(item, 'service', 123, 'conversation', 'same-message');
  check('inquiry retry preserves local cancellation', () => assert.equal(activity.getActivity('booked')[0].status, 'cancelled'));
  activity.recordBooking(item, 'service', 123, 'conversation', 'new-message');
  check('new inquiry retains a separate record', () => assert.equal(activity.getActivity('booked').length, 2));

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
  await Promise.all([
    api.toggleFavorite('service', 'three'),
    api.updateWishlist(current => ({ ...current, groups: [{ name: '旅行', service_ids: ['one'] }] })),
  ]);
  check('group edit preserves concurrent favorite changes', () => assert.deepEqual(profile.service_ids, ['one', 'two', 'three']));
  check('group edit and favorites share the write queue', () => assert.equal(profile.groups[0].name, '旅行'));
  await Promise.all([api.removeFavorite('service', 'one'), api.removeFavorite('service', 'one')]);
  check('repeated removal never re-adds a favorite', () => assert.ok(!profile.service_ids.includes('one')));
  check('removal also clears group membership', () => assert.deepEqual(profile.groups[0].service_ids, []));
  await assert.rejects(api.updateWishlist(() => { throw new Error('Invalid group edit'); }));
  await api.toggleFavorite('service', 'after-error');
  check('failed group edit does not block later favorites', () => assert.ok(profile.service_ids.includes('after-error')));
  await api.toggleFavorite('service', 'photo', ' 摄影 ');
  check('home favorite is automatically placed in its Android category', () => assert.deepEqual(
    profile.groups.find(group => group.name === '摄影').service_ids, ['photo']));
  await api.toggleFavorite('service', 'photo2', '摄影');
  check('category favorite reuses the existing group', () => {
    assert.equal(profile.groups.filter(group => group.name === '摄影').length, 1);
    assert.deepEqual(profile.groups.find(group => group.name === '摄影').service_ids, ['photo', 'photo2']);
  });
  await api.toggleFavorite('service', 'unknown-category', 'invalid');
  check('unknown favorite category uses the Android generic group', () => assert.deepEqual(
    profile.groups.find(group => group.name === '其他服务').service_ids, ['unknown-category']));
  await api.toggleFavorite('service', 'photo', '摄影');
  check('home removal clears automatic category membership', () => assert.deepEqual(
    profile.groups.find(group => group.name === '摄影').service_ids, ['photo2']));

  const useResource = load('src/hooks/useResource.ts').useResource;
  const resourceWait = deferred();
  const resourceRenderer = createRenderer(resourceKey => useResource(() => resourceWait.promise, [], resourceKey || 'favorites-test'));
  let resource = resourceRenderer.render();
  const refreshingResource = resource.refresh();
  resource.setData(['confirmed-favorite']);
  resourceWait.resolve(['stale-favorite']);
  await refreshingResource;
  resource = resourceRenderer.render();
  check('confirmed resource mutation rejects older refresh results', () => assert.deepEqual(resource.data, ['confirmed-favorite']));
  const oldKeySetter = resource.setData;
  resourceRenderer.render('another-resource');
  oldKeySetter(['wrong-resource']);
  check('setter for an old resource key cannot fill the new resource', () => assert.deepEqual(
    resourceRenderer.render('another-resource').data, []));
  resource = resourceRenderer.render('another-resource');
  const oldSetData = resource.setData;
  session.setSession('new-resource-login', { ...readyUser, id: 'new-resource-user' }, 'resource-refresh');
  resource = resourceRenderer.render();
  check('new login immediately hides old resource data', () => assert.deepEqual(resource.data, []));
  oldSetData(['old-account-mutation']);
  resource = resourceRenderer.render();
  check('old resource setter cannot populate the new login', () => assert.deepEqual(resource.data, []));
  resourceRenderer.unmount();

  const ItemCard = load('src/components/ItemCard/index.tsx').default;
  const cardProps = { item: { id: 'card-lock', title: 'Photo', category: '摄影' }, kind: 'service',
    home: true, favorite: false, onFavorite: active => cardChanges.push(active) };
  const cardChanges = [];
  const cardRenderer = createRenderer(ItemCard);
  const favoriteControl = tree => tree.props.children[0].props.children[2];
  const cardWriteStarted = deferred();
  const cardWriteWait = deferred();
  let cardWrites = 0;
  requestHandler = async options => {
    if (options.method === 'PUT') {
      cardWrites++;
      cardWriteStarted.resolve();
      return cardWriteWait.promise;
    }
    return response({ service_ids: [], groups: [] });
  };
  const click = favoriteControl(cardRenderer.render(cardProps)).props.onClick;
  click({ stopPropagation() {} });
  click({ stopPropagation() {} });
  await cardWriteStarted.promise;
  check('same-render rapid favorite clicks submit one write', () => assert.equal(cardWrites, 1));
  check('pending favorite shows progress feedback', () => assert.equal(
    favoriteControl(cardRenderer.render(cardProps)).props.children[0], '…'));
  session.setSession('replacement-card-login', { ...readyUser, id: 'replacement-card-user' }, 'card-refresh');
  cardRenderer.render(cardProps);
  const toastCount = toasts.length;
  cardWriteWait.resolve(response({ service_ids: ['card-lock'], groups: [] }));
  for (let tick = 0; tick < 20; tick++) await Promise.resolve();
  check('old card completion cannot update replacement account favorites', () => assert.deepEqual(cardChanges, []));
  check('old card failure does not toast over replacement account', () => assert.equal(toasts.length, toastCount));
  check('account change releases visible favorite progress', () => assert.equal(
    favoriteControl(cardRenderer.render(cardProps)).props.children[0], '♡'));
  cardRenderer.unmount();
  const successfulCard = createRenderer(ItemCard);
  let successfulProfile = { service_ids: [], groups: [] };
  requestHandler = async options => {
    if (options.method === 'PUT') successfulProfile = options.data;
    return response(successfulProfile);
  };
  favoriteControl(successfulCard.render(cardProps)).props.onClick({ stopPropagation() {} });
  for (let tick = 0; tick < 20; tick++) await Promise.resolve();
  check('successful favorite reports its confirmed state once', () => assert.deepEqual(cardChanges, [true]));
  check('successful home favorite preserves category assignment', () => assert.deepEqual(
    successfulProfile.groups, [{ name: '摄影', service_ids: ['card-lock'] }]));
  check('successful favorite displays Android feedback text', () => assert.equal(toasts.at(-1), '已加入心愿单'));
  successfulCard.unmount();
  requestHandler = async options => options.url.includes('before=100')
    ? response([{ id: 'oldest', created_at: 1, sender_id: 'starter' }])
    : response(Array.from({ length: 500 }, (_, index) => ({ id: `message-${index}`, created_at: 100 + index, sender_id: 'recent' })));
  const starter = await api.getConversationStarter('conversation');
  check('inquiry classification reads earlier pages', () => assert.equal(starter, 'starter'));
  let cursorUrl = '';
  requestHandler = async options => { cursorUrl = options.url; return response([]); };
  await api.getMessages('encoded/id', 0, 'boundary/id?');
  check('history sends timestamp zero and URL-encoded tie-breaker ID', () => {
    assert.ok(cursorUrl.includes('/encoded%2Fid/messages?limit=100&before=0&before_id=boundary%2Fid%3F'));
  });
  let sameTimePages = 0;
  requestHandler = async options => {
    sameTimePages++;
    if (options.url.includes('&before_id=')) {
      check('starter classification includes the same-timestamp message ID', () => assert.ok(options.url.includes('before_id=row-0500')));
      return response([{ id: 'row-0001', created_at: 100, sender_id: 'true-starter' }]);
    }
    return response(Array.from({ length: 500 }, (_, index) => ({ id: `row-${String(500 + index).padStart(4, '0')}`, created_at: 100, sender_id: 'recent' })));
  };
  const sameTimeStarter = await api.getConversationStarter('same-time');
  check('starter classification continues across equal timestamps', () => assert.equal(sameTimeStarter, 'true-starter'));
  check('same-time classification completes in two requests', () => assert.equal(sameTimePages, 2));
  const chatUtils = load('src/utils/chat.ts');
  const linkedMessage = { extra: { experience_id: 'experience-1', title: '徒步体验', inquiry_date: '2030年5月1日' } };
  check('experience consultation reads actual inquiry date and avoids duplicate suffix', () => assert.equal(
    chatUtils.chatInquiryMeta([linkedMessage], {}).summary, '关于2030年5月1日徒步体验的咨询'));
  check('new inquiry route date takes precedence over previous conversation inquiry', () => assert.equal(
    chatUtils.chatInquiryMeta([linkedMessage], { kind: 'experience', id: 'experience-1', date: '2030年5月2日' }).date, '2030年5月2日'));
  check('unrelated listing messages do not supply a consultation date', () => assert.equal(
    chatUtils.chatInquiryMeta([linkedMessage], { kind: 'service', id: 'different-service' }).date, ''));
  check('native start and end date extras supply the real consultation range', () => assert.equal(
    chatUtils.chatInquiryMeta([{ extra: { service_id: 'service-1', start_date: '2030-01-01', end_date: '2030-01-03' } }], {}).date,
    '2030-01-01至2030-01-03'));
  check('host profile entry suppresses a previous consultation link and summary', () => {
    const meta = chatUtils.chatInquiryMeta([linkedMessage], { hostProfile: true, createdAt: new Date(2030, 0, 2).getTime() });
    assert.equal(meta.id, ''); assert.equal(meta.summary, ''); assert.equal(meta.date, '2030年1月2日');
  });
  check('missing conversation dates do not produce demo metadata', () => assert.deepEqual(
    chatUtils.chatInquiryMeta([], {}), { kind: undefined, id: '', title: '', date: '', summary: '' }));
  check('invalid conversation dates do not produce a fake date', () => assert.equal(
    chatUtils.chatInquiryMeta([], { createdAt: Infinity }).date, ''));
  check('equal-timestamp messages sort by ID, not arrival order', () => assert.deepEqual(
    [{ id: 'z', created_at: 1 }, { id: 'a', created_at: 1 }, { id: 'b', created_at: 0 }]
      .sort(chatUtils.compareChatMessages).map(message => message.id), ['b', 'a', 'z']));
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
  session.setSession('epoch-old', user, 'epoch-refresh');
  const sameAccountWait = deferred();
  requestHandler = () => sameAccountWait.promise;
  const sameAccountRequest = api.request('/private');
  session.setSession('epoch-new', user, 'new-epoch-refresh');
  sameAccountWait.resolve(response({ old: true }));
  await assert.rejects(sameAccountRequest, error => error.status === 409);
  checks.push('same-account re-login invalidates earlier responses');

  const profileStarted = deferred();
  const profileWait = deferred();
  requestHandler = async options => {
    if (options.url.endsWith('/auth/token')) return response({ access_token: 'pending-login', refresh_token: 'pending-refresh' });
    profileStarted.resolve();
    return profileWait.promise;
  };
  const pendingLogin = api.login('13900000000', 'test-only');
  await profileStarted.promise;
  session.setSession('replacement-login', user, 'replacement-refresh');
  profileWait.resolve(response({}, 500));
  await assert.rejects(pendingLogin, error => error.status === 409);
  check('old failed login does not clear replacement login', () => assert.equal(session.getSession().token, 'replacement-login'));

  requestHandler = async options => {
    if (options.url.endsWith('/auth/token')) return response({ access_token: 'expired-login', refresh_token: 'expired-refresh' });
    if (options.url.endsWith('/auth/refresh')) return response({ access_token: 'rotated-login', refresh_token: 'rotated-refresh' });
    return options.header.Authorization === 'Bearer expired-login' ? response({}, 401) : response(user);
  };
  await api.login('13900000000', 'test-only');
  check('profile hydration retains rotated access token', () => assert.equal(session.getSession().token, 'rotated-login'));
  check('profile hydration retains rotated refresh token', () => assert.equal(session.getSession().refreshToken, 'rotated-refresh'));

  const staleRefreshStarted = deferred();
  const staleRefreshWait = deferred();
  session.setSession('stale-access', user, 'stale-refresh');
  requestHandler = async options => {
    if (options.url.endsWith('/auth/refresh')) {
      if (options.data.refresh_token === 'stale-refresh') {
        staleRefreshStarted.resolve();
        return staleRefreshWait.promise;
      }
      return response({ access_token: 'fresh-rotated', refresh_token: 'fresh-rotated-refresh' });
    }
    return ['Bearer stale-access', 'Bearer fresh-expired'].includes(options.header.Authorization)
      ? response({}, 401) : response({ ok: true });
  };
  const staleRequest = api.request('/old-generation');
  await staleRefreshStarted.promise;
  session.setSession('fresh-expired', user, 'fresh-refresh');
  const freshRequest = await api.request('/new-generation');
  check('new login refresh does not wait on old login refresh', () => assert.equal(freshRequest.ok, true));
  staleRefreshWait.resolve(response({}, 401));
  await assert.rejects(staleRequest, error => error.status === 401);
  check('old refresh failure does not log out the same-account replacement', () => assert.equal(session.getSession().token, 'fresh-rotated'));

  const oldUploadWait = deferred();
  uploadHandler = () => oldUploadWait.promise;
  const oldUpload = api.upload('/tmp/test-only.jpg', 'chat');
  session.setSession('same-user-new-login', user, 'same-user-new-refresh');
  oldUploadWait.resolve(response('{"url":"/static/old.jpg"}'));
  await assert.rejects(oldUpload, error => error.status === 409);
  checks.push('same-account re-login invalidates old upload responses');

  session.setSession('old', user, 'refresh');
  const messageRequests = [];
  requestHandler = async options => {
    if (options.url.endsWith('/auth/refresh')) return response({
      access_token: 'message-refreshed', refresh_token: 'message-refresh',
    });
    messageRequests.push({ ...options.data });
    return options.header.Authorization === 'Bearer old' ? response({}, 401)
      : response({ id: 'message', ...options.data });
  };
  const messageInput = { type: 'text', content: 'test message' };
  await api.sendMessage('conversation', messageInput);
  check('message API generates a request ID without mutating input', () => {
    assert.ok(messageRequests[0].client_message_id);
    assert.equal(messageInput.client_message_id, undefined);
  });
  check('automatic message retry preserves its request ID', () => {
    assert.equal(messageRequests.length, 2);
    assert.equal(messageRequests[0].client_message_id, messageRequests[1].client_message_id);
  });
  await api.sendMessage('conversation', { ...messageInput, client_message_id: 'caller-stable-id' });
  check('caller-provided message ID is preserved', () => assert.equal(
    messageRequests[2].client_message_id, 'caller-stable-id',
  ));

  const conversationRows = Array.from({ length: 107 }, (_, index) => ({ conversation: { id: `c-${index}` } }));
  let conversationRequests = 0;
  requestHandler = async options => {
    conversationRequests++;
    const skip = Number(new URL(options.url).searchParams.get('skip'));
    return response(conversationRows.slice(skip, skip + 100));
  };
  const allConversations = await api.getConversations();
  check('conversation API loads all pages', () => assert.equal(allConversations.length, 107));
  check('conversation pagination uses the next offset', () => assert.equal(conversationRequests, 2));
  conversationRequests = 0;
  requestHandler = async () => { conversationRequests++; return response(conversationRows.slice(0, 100)); };
  const legacyConversations = await api.getConversations();
  check('old unpaginated servers do not create an infinite loop', () => {
    assert.equal(legacyConversations.length, 100); assert.equal(conversationRequests, 2);
  });
  const authentication = load('src/utils/authentication.ts');
  check('onboarding first requires phone verification', () => assert.equal(authentication.onboardingDestination(
    { ...readyUser, is_phone_verified: false }), '/pages/bind-phone/index'));
  check('server binding requirement takes precedence over completed fields', () => assert.equal(
    authentication.onboardingDestination(readyUser, true), '/pages/bind-phone/index'));
  check('verified flag without a phone cannot bypass binding', () => assert.equal(
    authentication.onboardingDestination({ ...readyUser, phone_number: '' }), '/pages/bind-phone/index'));
  check('actual complete fields override a stale incomplete profile flag', () => assert.equal(
    authentication.onboardingDestination(readyUser), null));
  for (const field of ['name', 'gender', 'region', 'photo_url']) {
    check(`profile flag cannot hide missing required ${field}`, () => assert.equal(
      authentication.onboardingDestination({ ...readyUser, is_profile_completed: true, [field]: ' ' }), '/pages/profile-edit/index'));
  }
  session.logout();
  const navigationStart = navigations.length;
  check('signed-out business entry requires login', () => assert.equal(session.requireLogin(), false));
  check('same-render repeated login gate is still blocked', () => assert.equal(session.requireLogin(), false));
  check('signed-out gate opens login once', () => assert.deepEqual(navigations.slice(navigationStart), ['open:/pages/login/index']));
  session.setSession('unbound', { ...readyUser, is_phone_verified: false }, 'refresh');
  const beforeBindingGate = navigations.length;
  check('binding page can use authentication-only gate without a loop', () => assert.equal(session.requireSession(), true));
  check('unbound business entry is blocked', () => assert.equal(session.requireLogin(), false));
  check('unbound business entry opens binding', () => assert.equal(navigations.at(-1), 'open:/pages/bind-phone/index'));
  session.requireLogin();
  check('same-render repeated binding gate opens only one page', () => assert.equal(navigations.length, beforeBindingGate + 1));
  session.setSession('profile-required', { ...readyUser, gender: '' }, 'refresh');
  check('incomplete business entry opens profile completion', () => {
    assert.equal(session.requireLogin(), false);
    assert.equal(navigations.at(-1), 'open:/pages/profile-edit/index');
  });
  session.setSession('ready', readyUser, 'refresh');
  check('complete verified account may use business entry', () => assert.equal(session.requireLogin(), true));
  await session.finishAccountFlow(readyUser, session.getSessionGeneration());
  check('completed account flow returns to the original page', () => assert.equal(navigations.at(-1), 'back'));
  backHandler = async () => { throw new Error('No previous page'); };
  await session.finishAccountFlow(readyUser, session.getSessionGeneration());
  check('empty back stack falls back to the account tab', () => assert.equal(navigations.at(-1), 'tab:/pages/mine/index'));
  const backWait = deferred();
  backHandler = () => backWait.promise;
  const staleNavigation = session.finishAccountFlow(readyUser, session.getSessionGeneration());
  session.setSession('ready-again', readyUser, 'refresh');
  const beforeBackFailure = navigations.length;
  backWait.reject(new Error('No previous page'));
  await staleNavigation;
  check('old back-stack failure cannot navigate a replacement login', () => assert.equal(navigations.length, beforeBackFailure));
  await assert.rejects(session.finishAccountFlow(readyUser, session.getSessionGeneration() - 1), /登录状态已变化/);
  checks.push('old login completion cannot navigate the current account');
  backHandler = async () => {};

  const nodes = tree => !tree || typeof tree !== 'object' || !tree.props ? []
    : [tree, ...(tree.props.children || []).flat().flatMap(nodes)];
  const inputPhoneAndCode = (renderer, phone = '13800138000', code = '123456') => {
    let output = renderer.render();
    nodes(output).filter(node => node.type === 'Input')[0].props.onInput({ detail: { value: phone } });
    output = renderer.render();
    nodes(output).filter(node => node.type === 'Input')[1].props.onInput({ detail: { value: code } });
    return renderer.render();
  };
  const action = (tree, label) => nodes(tree).find(node => node.type?.name === 'ActionButton' && node.props.children.includes(label));
  const flushCallbacks = async () => { for (let tick = 0; tick < 30; tick++) await Promise.resolve(); };
  const LoginPage = load('src/pages/login/Page.tsx').default;
  const loginRenderer = createRenderer(LoginPage);
  let loginTree = inputPhoneAndCode(loginRenderer, '13800138000', 'password123');
  nodes(loginTree).find(node => node.type === 'View' && node.props.onClick
    && node.props.children.some(child => child?.type === 'Checkbox')).props.onClick();
  loginTree = loginRenderer.render();
  const loginStarted = deferred();
  const loginWait = deferred();
  let loginWrites = 0;
  const unboundUser = { ...readyUser, is_phone_verified: false };
  requestHandler = async options => {
    if (options.url.endsWith('/auth/token')) { loginWrites++; loginStarted.resolve(); return loginWait.promise; }
    if (options.url.endsWith('/auth/me')) return response(unboundUser);
    throw new Error('Unexpected login request');
  };
  const loginClick = action(loginTree, '登录').props.onClick;
  loginClick(); loginClick();
  await loginStarted.promise;
  check('same-render login clicks submit only once', () => assert.equal(loginWrites, 1));
  loginWait.resolve(response({ access_token: 'unbound-password-login', refresh_token: 'refresh' }));
  await flushCallbacks();
  check('password login obeys phone binding before profile completion', () => assert.equal(
    navigations.at(-1), 'redirect:/pages/bind-phone/index'));
  loginRenderer.unmount();

  const BindPhonePage = load('src/pages/bind-phone/index.tsx').default;
  const bindingRenderer = createRenderer(BindPhonePage);
  let bindingTree = inputPhoneAndCode(bindingRenderer);
  const bindingStarted = deferred();
  const oldBindingWait = deferred();
  let bindingWrites = 0;
  requestHandler = async () => { bindingWrites++; bindingStarted.resolve(); return oldBindingWait.promise; };
  const bindingClick = action(bindingTree, '绑定并下一步').props.onClick;
  bindingClick(); bindingClick();
  await bindingStarted.promise;
  check('same-render binding clicks submit only once', () => assert.equal(bindingWrites, 1));
  const replacementUser = { ...unboundUser, id: 'replacement-binding-user' };
  session.setSession('replacement-binding', replacementUser, 'refresh');
  check('replacement login hides the previous phone form before reset', () => assert.equal(bindingRenderer.render().props.loading, true));
  bindingTree = inputPhoneAndCode(bindingRenderer);
  const newBindingStarted = deferred();
  const newBindingWait = deferred();
  requestHandler = async () => { newBindingStarted.resolve(); return newBindingWait.promise; };
  action(bindingTree, '绑定并下一步').props.onClick();
  await newBindingStarted.promise;
  oldBindingWait.resolve(response(readyUser));
  await flushCallbacks();
  bindingTree = bindingRenderer.render();
  check('old binding result cannot overwrite replacement account', () => assert.equal(session.getSession().user.id, replacementUser.id));
  check('old binding completion cannot unlock a newer binding request', () => assert.equal(
    action(bindingTree, '绑定并下一步').props.loading, true));
  newBindingWait.resolve(response({ ...replacementUser, is_phone_verified: true }));
  await flushCallbacks();
  check('successful binding updates only the active login', () => assert.equal(session.getSession().user.is_phone_verified, true));
  check('completed binding returns to the original page', () => assert.equal(navigations.at(-1), 'back'));
  bindingRenderer.unmount();
  const PublishPage = load('src/pages/publish/Page.tsx').default;
  session.setSession('publish-unbound', unboundUser, 'refresh');
  const publishRenderer = createRenderer(PublishPage);
  publishRenderer.render();
  check('direct publish entry sends an unbound user to binding', () => assert.equal(navigations.at(-1), 'open:/pages/bind-phone/index'));
  session.updateSessionUser(readyUser);
  publishRenderer.render();
  let publishTree = publishRenderer.render();
  check('binding completion resumes the waiting publish form without a new login', () => assert.ok(
    nodes(publishTree).some(node => node.type === 'Input')));
  session.setSession('publish-same-account-again', readyUser, 'refresh');
  check('same-account re-login hides the old publish form immediately', () => assert.equal(publishRenderer.render().props.loading, true));
  publishTree = publishRenderer.render();
  check('new login rehydrates the publish form', () => assert.ok(nodes(publishTree).some(node => node.type === 'Input')));
  publishRenderer.unmount();
  session.setSession('hydrating-login', null, 'refresh');
  const hydratingPublisher = createRenderer(PublishPage);
  const beforeHydration = navigations.length;
  check('publish waits for password login profile hydration', () => assert.equal(hydratingPublisher.render().props.loading, true));
  check('temporary token-only login does not open a duplicate login page', () => assert.equal(navigations.length, beforeHydration));
  hydratingPublisher.unmount();
  const ThreadPage = load('src/pages/thread/index.tsx').default;
  const chatIntervals = new Map();
  let chatTimerId = 0;
  intervals = {
    setInterval(callback) { chatIntervals.set(++chatTimerId, callback); return chatTimerId; },
    clearInterval(id) { chatIntervals.delete(id); },
  };
  routerParams = { id: 'chat-test' };
  session.setSession('chat-unbound', unboundUser, 'refresh');
  let chatReads = 0, chatMetadataReads = 0;
  const chatMessage = (id, content) => ({ id, content, conversation_id: 'chat-test', sender_id: readyUser.id,
    created_at: 1000, is_deleted: false, type: 'text', extra: {} });
  requestHandler = async options => {
    if (options.method === 'GET' && options.url.includes('/messages?')) { chatReads++; return response([chatMessage('initial-chat', 'initial history')]); }
    if (options.method === 'GET') { chatMetadataReads++; return response([]); }
    return response({});
  };
  const threadRenderer = createRenderer(ThreadPage);
  let chatTree = threadRenderer.render();
  threadRenderer.show(); chatTree = threadRenderer.render();
  check('unbound direct chat entry has no history request', () => assert.equal(chatReads, 0));
  check('unbound direct chat entry does not read account or service metadata', () => assert.equal(chatMetadataReads, 0));
  check('unbound direct chat entry has no socket or polling timer', () => {
    assert.equal(sockets.length, 0); assert.equal(chatIntervals.size, 0);
  });
  check('unbound direct chat entry opens phone binding', () => assert.equal(navigations.at(-1), 'open:/pages/bind-phone/index'));
  session.updateSessionUser(readyUser);
  threadRenderer.render();
  await flushCallbacks();
  chatTree = threadRenderer.render();
  check('phone binding resumes chat history without changing login', () => assert.ok(
    nodes(chatTree).some(node => node.props.children.includes('initial history'))));
  check('visible verified chat starts one socket and one polling timer', () => {
    assert.equal(sockets.length, 1); assert.equal(chatIntervals.size, 1);
  });
  const firstSocket = sockets[0];
  firstSocket.message({ data: JSON.stringify({ type: 'message', message: chatMessage('live-chat', 'live socket message') }) });
  chatTree = threadRenderer.render();
  check('active socket message is merged into the conversation', () => assert.ok(
    nodes(chatTree).some(node => node.props.children.includes('live socket message'))));
  nodes(chatTree).find(node => node.type === 'Input').props.onInput({ detail: { value: 'first draft' } });
  chatTree = threadRenderer.render();
  const sendStarted = deferred(), sendWait = deferred();
  let chatWrites = 0;
  requestHandler = async options => {
    if (options.url.endsWith('/messages') && options.method === 'POST') {
      chatWrites++; sendStarted.resolve(); return sendWait.promise;
    }
    return response([]);
  };
  const sendClick = action(chatTree, '发送').props.onClick;
  sendClick(); sendClick();
  await sendStarted.promise;
  check('same-render chat send clicks submit one message', () => assert.equal(chatWrites, 1));
  nodes(threadRenderer.render()).find(node => node.type === 'Input').props.onInput({ detail: { value: 'next draft while waiting' } });
  threadRenderer.render();
  sendWait.resolve(response(chatMessage('sent-chat', 'first draft')));
  await flushCallbacks();
  chatTree = threadRenderer.render();
  check('sent message does not erase a newer input draft', () => assert.equal(
    nodes(chatTree).find(node => node.type === 'Input').props.value, 'next draft while waiting'));
  check('successful chat send merges only its confirmed message', () => assert.ok(
    nodes(chatTree).some(node => node.props.children.includes('first draft'))));
  check('successful chat send releases the shared operation lock', () => assert.equal(action(chatTree, '发送').props.loading, false));
  check('plain chat messages use the separate Android text bubble style', () => assert.ok(
    nodes(chatTree).some(node => node.type === 'View' && node.props.className?.includes('textBubble'))));
  const chatStyles = fs.readFileSync(path.join(__dirname, 'src/pages/thread/index.module.scss'), 'utf8');
  check('chat text bubble stylesheet matches Android sender and receiver colors', () => {
    assert.match(chatStyles, /\.textBubble\s*\{\s*background:\s*#EFEFEF/);
    assert.match(chatStyles, /\.mine\s+\.textBubble\s*\{\s*background:\s*#3B3D43/);
    assert.match(chatStyles, /\.mine\s+\.locationBubble\s*\{\s*background:\s*#DDF5C8/);
  });

  const imageWait = deferred();
  let imagePicks = 0, chatUploads = 0;
  imagePicker = async () => { imagePicks++; return imageWait.promise; };
  uploadHandler = async () => { chatUploads++; return { statusCode: 200, data: '{"url":"/static/chat.jpg"}' }; };
  const imageClick = nodes(chatTree).find(node => node.type === 'Text' && node.props.children.includes('图片')).props.onClick;
  imageClick(); imageClick();
  check('same-render chat image clicks open one picker', () => assert.equal(imagePicks, 1));
  session.setSession('chat-same-user-new-login', readyUser, 'refresh');
  firstSocket.message({ data: JSON.stringify({ type: 'message', message: chatMessage('old-chat', 'stale socket message') }) });
  check('same-account re-login hides the previous conversation immediately', () => assert.equal(threadRenderer.render().props.loading, true));
  await flushCallbacks();
  chatTree = threadRenderer.render();
  check('re-login clears the previous draft', () => assert.equal(nodes(chatTree).find(node => node.type === 'Input').props.value, ''));
  check('old socket message cannot populate a new login', () => assert.ok(
    !nodes(chatTree).some(node => node.props.children.includes('stale socket message'))));
  check('re-login closes the previous socket', () => assert.equal(firstSocket.closes, 1));
  check('re-login replaces rather than duplicates the polling timer', () => assert.equal(chatIntervals.size, 1));
  const replacementSendStarted = deferred(), replacementSendWait = deferred();
  requestHandler = async options => {
    if (options.url.endsWith('/messages') && options.method === 'POST') {
      replacementSendStarted.resolve(); return replacementSendWait.promise;
    }
    return response([]);
  };
  nodes(chatTree).find(node => node.type === 'Input').props.onInput({ detail: { value: 'new login draft' } });
  chatTree = threadRenderer.render();
  action(chatTree, '发送').props.onClick();
  await replacementSendStarted.promise;
  imageWait.resolve({ tempFilePaths: ['/tmp/chat-old-choice.jpg'] });
  await flushCallbacks();
  check('old login picker result does not upload under a new token', () => assert.equal(chatUploads, 0));
  check('old picker cleanup cannot unlock a newer send', () => assert.equal(action(threadRenderer.render(), '发送').props.loading, true));
  replacementSendWait.resolve(response(chatMessage('new-login-send', 'new login draft')));
  await flushCallbacks();
  chatTree = threadRenderer.render();
  check('unchanged sent draft is cleared after confirmation', () => assert.equal(nodes(chatTree).find(node => node.type === 'Input').props.value, ''));
  threadRenderer.hide(); threadRenderer.render();
  check('hidden chat closes its active socket', () => assert.equal(sockets.at(-1).closes, 1));
  check('hidden chat stops periodic REST refresh', () => assert.equal(chatIntervals.size, 0));
  threadRenderer.unmount();
  check('chat unmount removes keyboard callbacks', () => assert.equal(keyboardListeners.size, 0));
  const historyRenderer = createRenderer(ThreadPage);
  requestHandler = async options => options.method === 'GET' && options.url.includes('/messages?')
    ? response(Array.from({ length: 100 }, (_, index) => ({ ...chatMessage(`history-${index}`, `history ${index}`), created_at: 1000 + index })))
    : response(options.method === 'GET' ? [] : {});
  historyRenderer.render();
  await flushCallbacks();
  let historyTree = historyRenderer.render();
  const historyStarted = deferred(), historyWait = deferred();
  let historyReads = 0, historyRequest = '';
  requestHandler = async options => {
    if (options.url.includes('&before=')) { historyReads++; historyRequest = options.url; historyStarted.resolve(); return historyWait.promise; }
    return response([]);
  };
  const historyClick = nodes(historyTree).find(node => node.type === 'Text' && node.props.children.includes('加载更早消息')).props.onClick;
  historyClick(); historyClick();
  await historyStarted.promise;
  check('same-render history clicks request one page', () => assert.equal(historyReads, 1));
  check('thread history supplies both oldest timestamp and oldest ID', () => assert.ok(
    historyRequest.includes('&before=1000&before_id=history-0')));
  session.setSession('history-new-login', readyUser, 'refresh');
  check('re-login hides old history before the new request completes', () => assert.equal(historyRenderer.render().props.loading, true));
  await flushCallbacks();
  historyWait.resolve(response([chatMessage('stale-history', 'stale historical page')]));
  await flushCallbacks();
  historyTree = historyRenderer.render();
  check('old historical page cannot merge into a replacement login', () => assert.ok(
    !nodes(historyTree).some(node => node.props.children.includes('stale historical page'))));
  check('old history completion does not leave the new composer busy', () => assert.equal(action(historyTree, '发送').props.loading, false));
  historyRenderer.unmount();

  const originalConnectSocket = taro.connectSocket;
  const delayedSocketWait = deferred();
  const delayedSocket = { closes: 0, registrations: 0,
    async close() { delayedSocket.closes++; }, onMessage() { delayedSocket.registrations++; }, onError() {} };
  taro.connectSocket = () => delayedSocketWait.promise;
  requestHandler = async () => response([]);
  const delayedSocketRenderer = createRenderer(ThreadPage);
  delayedSocketRenderer.render(); delayedSocketRenderer.show(); delayedSocketRenderer.render();
  delayedSocketRenderer.hide(); delayedSocketRenderer.render(); delayedSocketRenderer.unmount();
  delayedSocketWait.resolve(delayedSocket);
  await flushCallbacks();
  check('connection returned after hide is immediately closed', () => assert.equal(delayedSocket.closes, 1));
  check('late connection never registers message callbacks', () => assert.equal(delayedSocket.registrations, 0));
  check('hidden and unmounted delayed connection leaves no refresh timer', () => assert.equal(chatIntervals.size, 0));
  taro.connectSocket = originalConnectSocket;
  const feedWait = deferred();
  let feedReads = 0;
  requestHandler = async options => {
    if (options.method === 'GET' && options.url.includes('/messages?')) { feedReads++; return feedWait.promise; }
    if (options.method === 'GET') return response([]);
    return response({});
  };
  const feedRenderer = createRenderer(ThreadPage);
  feedRenderer.render(); feedRenderer.show(); feedRenderer.render();
  for (const refresh of chatIntervals.values()) refresh();
  check('initial, visible and periodic refresh share one active read', () => assert.equal(feedReads, 1));
  feedWait.resolve(response([]));
  await flushCallbacks();
  check('completed read clears the initial loading state', () => assert.equal(
    nodes(feedRenderer.render()).find(node => node.type?.name === 'StateView').props.loading, false));
  let failedSendTree = feedRenderer.render();
  nodes(failedSendTree).find(node => node.type === 'Input').props.onInput({ detail: { value: 'draft after send failure' } });
  failedSendTree = feedRenderer.render();
  requestHandler = async options => options.method === 'POST' ? response({ detail: 'Message rejected' }, 400) : response([]);
  action(failedSendTree, '发送').props.onClick();
  await flushCallbacks();
  failedSendTree = feedRenderer.render();
  check('failed send retains the current input draft', () => assert.equal(
    nodes(failedSendTree).find(node => node.type === 'Input').props.value, 'draft after send failure'));
  check('failed send releases the operation lock for retry', () => assert.equal(action(failedSendTree, '发送').props.loading, false));
  feedRenderer.unmount();
  check('all chat tests clean up keyboard and timer subscriptions', () => {
    assert.equal(keyboardListeners.size, 0); assert.equal(chatIntervals.size, 0);
  });
  const otherUser = { ...readyUser, id: 'chat-peer', name: 'Actual peer' };
  const actualService = { id: 'context-service', title: 'Actual service', price_text: '¥120',
    location: '北京|||PEIPEI_GEO1|||metadata', cover_image_url: '/static/context.jpg', image_urls: [] };
  const metadata = { conversation: { id: 'chat-test', title: 'Actual conversation',
    participant_ids: [readyUser.id, otherUser.id] }, peer: otherUser };
  const hasText = (tree, text) => nodes(tree).some(node => node.props.children.includes(text));
  routerParams = { id: 'chat-test', service: actualService.id };
  session.setSession('context-login', readyUser, 'refresh');
  const contextWait = deferred();
  let profileReads = 0;
  requestHandler = async options => {
    if (options.url.includes('/chat/conversations?')) return response([metadata]);
    if (options.url.endsWith(`/services/${actualService.id}`)) return contextWait.promise;
    if (options.url.includes('/users/')) { profileReads++; return response(otherUser); }
    return response(options.method === 'GET' ? [] : {});
  };
  const contextRenderer = createRenderer(ThreadPage);
  let contextTree = contextRenderer.render();
  check('service context card is outside the scrolling history', () => assert.ok(
    contextTree.props.children.some(child => child?.props?.className === 'pinnedSection')));
  check('loading context shows no fabricated price or date', () => {
    assert.ok(hasText(contextTree, '正在加载服务信息'));
    assert.ok(!hasText(contextTree, '¥120'));
    assert.ok(!hasText(contextTree, '2021年2月9日至19日'));
  });
  await flushCallbacks();
  contextTree = contextRenderer.render();
  await flushCallbacks();
  contextTree = contextRenderer.render();
  check('direct conversation entry recovers its peer from the existing API', () => assert.ok(hasText(contextTree, otherUser.name)));
  check('conversation-provided peer does not require another profile request', () => assert.equal(profileReads, 0));
  contextWait.resolve(response(actualService));
  await flushCallbacks();
  contextTree = contextRenderer.render();
  check('pinned card displays the server service title', () => assert.ok(hasText(contextTree, actualService.title)));
  check('pinned card displays price and strips encoded map metadata', () => assert.ok(hasText(contextTree, '¥120 · 北京')));
  check('pinned card uses the real service cover', () => assert.ok(
    nodes(contextTree).some(node => node.type === 'Image' && node.props.src.endsWith('/static/context.jpg'))));
  const pinned = nodes(contextTree).find(node => node.props.className === 'pinnedCard');
  pinned.props.onClick();
  await flushCallbacks();
  check('pinned service card opens its linked detail', () => assert.equal(
    navigations.at(-1), 'open:/pages/service-detail/index?id=context-service'));
  nodes(contextTree).find(node => node.props.className === 'header').props.onClick();
  await flushCallbacks();
  check('hydrated header opens the actual peer profile', () => assert.equal(navigations.at(-1), 'open:/pages/profile/index?id=chat-peer'));
  contextRenderer.unmount();

  routerParams = { id: 'chat-test' };
  let inferredReads = 0;
  requestHandler = async options => {
    if (options.url.includes('/chat/conversations?')) return response([]);
    if (options.url.includes('/users/')) { inferredReads++; return response(otherUser); }
    if (options.url.includes('/messages?')) return response([{ ...chatMessage('peer-message', 'peer history'), sender_id: otherUser.id }]);
    return response({});
  };
  const inferredRenderer = createRenderer(ThreadPage);
  inferredRenderer.render();
  await flushCallbacks();
  inferredRenderer.render();
  await flushCallbacks();
  const inferredTree = inferredRenderer.render();
  check('message sender supplies a peer when conversation metadata is missing', () => {
    assert.equal(inferredReads, 1); assert.ok(hasText(inferredTree, otherUser.name));
  });
  check('ordinary message entry has no fabricated pinned service card', () => assert.ok(
    !nodes(inferredTree).some(node => node.props.className === 'pinnedCard')));
  inferredRenderer.unmount();
  requestHandler = async options => {
    if (options.url.includes('/chat/conversations?')) return response([{ conversation: metadata.conversation }]);
    if (options.url.includes('/users/')) return response(otherUser);
    return response(options.method === 'GET' ? [] : {});
  };
  const memberRenderer = createRenderer(ThreadPage);
  memberRenderer.render();
  await flushCallbacks();
  memberRenderer.render();
  await flushCallbacks();
  const memberTree = memberRenderer.render();
  check('conversation member IDs hydrate a peer even with empty message history', () => assert.ok(hasText(memberTree, otherUser.name)));
  memberRenderer.unmount();

  routerParams = { id: 'chat-test', service: actualService.id, peer: otherUser.id };
  const staleContextWait = deferred(), stalePeerWait = deferred();
  requestHandler = async options => {
    if (options.url.includes('/services/')) return staleContextWait.promise;
    if (options.url.includes('/users/')) return stalePeerWait.promise;
    return response(options.method === 'GET' ? [] : {});
  };
  const staleContextRenderer = createRenderer(ThreadPage);
  staleContextRenderer.render();
  session.setSession('replacement-context-login', readyUser, 'refresh');
  requestHandler = async options => {
    if (options.url.includes('/services/')) return response({ ...actualService, title: 'Replacement service' });
    if (options.url.includes('/users/')) return response({ ...otherUser, name: 'Replacement peer' });
    return response(options.method === 'GET' ? [] : {});
  };
  check('re-login immediately hides old service and peer data', () => assert.equal(staleContextRenderer.render().props.loading, true));
  await flushCallbacks();
  staleContextWait.resolve(response(actualService));
  stalePeerWait.resolve(response(otherUser));
  await flushCallbacks();
  const replacementContextTree = staleContextRenderer.render();
  check('old service result cannot overwrite replacement login context', () => {
    assert.ok(hasText(replacementContextTree, 'Replacement service'));
    assert.ok(!hasText(replacementContextTree, actualService.title));
  });
  check('old peer result cannot overwrite replacement login profile', () => {
    assert.ok(hasText(replacementContextTree, 'Replacement peer'));
    assert.ok(!hasText(replacementContextTree, otherUser.name));
  });
  staleContextRenderer.unmount();

  let contextAttempts = 0;
  requestHandler = async options => {
    if (options.url.includes('/services/')) {
      contextAttempts++;
      return contextAttempts === 1 ? response({ detail: 'Context unavailable' }, 503) : response(actualService);
    }
    if (options.url.includes('/users/')) return response(otherUser);
    return response(options.method === 'GET' ? [] : {});
  };
  const retryContextRenderer = createRenderer(ThreadPage);
  retryContextRenderer.render();
  await flushCallbacks();
  let retryContextTree = retryContextRenderer.render();
  check('failed context read has an explicit retry rather than fake content', () => {
    assert.ok(hasText(retryContextTree, '服务信息加载失败，点击重试'));
    assert.ok(!hasText(retryContextTree, actualService.title));
  });
  nodes(retryContextTree).find(node => node.props.children.includes('服务信息加载失败，点击重试')).props.onClick();
  await flushCallbacks();
  retryContextTree = retryContextRenderer.render();
  check('context retry uses the same real API and clears its error', () => {
    assert.equal(contextAttempts, 2); assert.ok(hasText(retryContextTree, actualService.title));
    assert.ok(!hasText(retryContextTree, '服务信息加载失败，点击重试'));
  });
  retryContextRenderer.unmount();
  let peerAttempts = 0;
  requestHandler = async options => {
    if (options.url.includes('/users/')) {
      peerAttempts++;
      return peerAttempts === 1 ? response({ detail: 'Peer unavailable' }, 503) : response(otherUser);
    }
    if (options.url.includes('/services/')) return response(actualService);
    return response(options.method === 'GET' ? [] : {});
  };
  const retryPeerRenderer = createRenderer(ThreadPage);
  retryPeerRenderer.render();
  await flushCallbacks();
  let retryPeerTree = retryPeerRenderer.render();
  check('failed peer read preserves a usable conversation and explicit retry', () => {
    assert.ok(hasText(retryPeerTree, '会话信息加载失败，点击重试'));
    assert.ok(nodes(retryPeerTree).some(node => node.type === 'Input'));
    assert.ok(hasText(retryPeerTree, '对方'));
  });
  nodes(retryPeerTree).find(node => node.props.children.includes('会话信息加载失败，点击重试')).props.onClick();
  await flushCallbacks();
  retryPeerTree = retryPeerRenderer.render();
  check('peer retry restores the actual header without reloading the conversation', () => {
    assert.equal(peerAttempts, 2); assert.ok(hasText(retryPeerTree, otherUser.name));
    assert.ok(!hasText(retryPeerTree, '会话信息加载失败，点击重试'));
  });
  retryPeerRenderer.unmount();
  routerParams = { id: 'chat-test', service: actualService.id, source: 'host_profile' };
  let hostServiceReads = 0;
  requestHandler = async options => {
    if (options.url.includes('/services/')) { hostServiceReads++; return response(actualService); }
    return response(options.method === 'GET' ? [] : {});
  };
  const hostRenderer = createRenderer(ThreadPage);
  const hostTree = hostRenderer.render();
  await flushCallbacks();
  check('host profile entry suppresses service consultation context as Android does', () => {
    assert.equal(hostServiceReads, 0);
    assert.ok(!nodes(hostTree).some(node => node.props.className === 'pinnedCard'));
  });
  hostRenderer.unmount();
  routerParams = { id: 'chat-test', experience: 'experience-context', inquiry_date: '2030年5月2日' };
  requestHandler = async options => {
    if (options.url.includes('/experiences/')) return response({ id: 'experience-context', title: '徒步体验' });
    return response(options.method === 'GET' ? [] : {});
  };
  const experienceRenderer = createRenderer(ThreadPage);
  const experienceTree = experienceRenderer.render();
  check('experience entry does not invent an Android pinned service card', () => assert.ok(
    !nodes(experienceTree).some(node => node.props.className === 'pinnedCard')));
  await flushCallbacks();
  const readyExperienceTree = experienceRenderer.render();
  check('experience inquiry renders actual listing title and requested date', () => assert.ok(
    hasText(readyExperienceTree, '关于2030年5月2日徒步体验的咨询')));
  nodes(readyExperienceTree).find(node => node.props.children.includes('显示体验')).props.onClick();
  await flushCallbacks();
  check('experience consultation link opens the actual experience detail', () => assert.equal(
    navigations.at(-1), 'open:/pages/experience-detail/index?id=experience-context'));
  experienceRenderer.unmount();
  routerParams = { id: 'chat-test' };
  session.setSession('retry-message-login', readyUser, 'refresh');
  const retryBodies = [];
  requestHandler = async options => {
    if (options.method === 'POST' && options.url.endsWith('/messages')) {
      retryBodies.push(options.data);
      return retryBodies.length === 1 ? response({ detail: 'Temporary failure' }, 503)
        : response({ ...chatMessage('retried-text', options.data.content), client_message_id: options.data.client_message_id });
    }
    return response(options.method === 'GET' ? [] : {});
  };
  const retrySendRenderer = createRenderer(ThreadPage);
  retrySendRenderer.render();
  await flushCallbacks();
  let retrySendTree = retrySendRenderer.render();
  nodes(retrySendTree).find(node => node.type === 'Input').props.onInput({ detail: { value: 'retry this text' } });
  retrySendTree = retrySendRenderer.render();
  action(retrySendTree, '发送').props.onClick();
  await flushCallbacks();
  retrySendTree = retrySendRenderer.render();
  check('failed text is visibly unconfirmed with an explicit resend action', () => {
    assert.ok(hasText(retrySendTree, '消息未确认发送')); assert.ok(action(retrySendTree, '重新发送'));
  });
  const resendClick = action(retrySendTree, '重新发送').props.onClick;
  resendClick(); resendClick();
  await flushCallbacks();
  retrySendTree = retrySendRenderer.render();
  check('same-render resend submits once with the exact original payload', () => {
    assert.equal(retryBodies.length, 2); assert.deepEqual(retryBodies[1], retryBodies[0]);
  });
  check('successful resend removes unconfirmed state and clears unchanged input', () => {
    assert.ok(!hasText(retrySendTree, '消息未确认发送'));
    assert.equal(nodes(retrySendTree).find(node => node.type === 'Input').props.value, '');
  });
  const changedDraftBodies = [];
  requestHandler = async options => {
    if (options.method === 'POST' && options.url.endsWith('/messages')) {
      changedDraftBodies.push(options.data);
      return changedDraftBodies.length === 1 ? response({ detail: 'Temporary failure' }, 503)
        : response({ ...chatMessage('retried-old-draft', options.data.content), client_message_id: options.data.client_message_id });
    }
    return response(options.method === 'GET' ? [] : {});
  };
  nodes(retrySendTree).find(node => node.type === 'Input').props.onInput({ detail: { value: 'old failed draft' } });
  retrySendTree = retrySendRenderer.render();
  action(retrySendTree, '发送').props.onClick();
  await flushCallbacks();
  retrySendTree = retrySendRenderer.render();
  nodes(retrySendTree).find(node => node.type === 'Input').props.onInput({ detail: { value: 'new draft to retain' } });
  retrySendTree = retrySendRenderer.render();
  action(retrySendTree, '重新发送').props.onClick();
  await flushCallbacks();
  retrySendTree = retrySendRenderer.render();
  check('retrying an older failed text preserves a newer input draft', () => assert.equal(
    nodes(retrySendTree).find(node => node.type === 'Input').props.value, 'new draft to retain'));
  check('older failed text retry reuses its own message key', () => assert.deepEqual(changedDraftBodies[0], changedDraftBodies[1]));
  let retryUploads = 0;
  const imageBodies = [];
  imagePicker = async () => ({ tempFilePaths: ['/tmp/retry-chat-image.jpg'] });
  uploadHandler = async () => {
    retryUploads++;
    return { statusCode: 200, data: JSON.stringify({ url: '/static/retry-image.jpg', object_key: 'retry-object' }) };
  };
  requestHandler = async options => {
    if (options.method === 'POST' && options.url.endsWith('/messages')) {
      imageBodies.push(options.data);
      return imageBodies.length === 1 ? response({ detail: 'Temporary failure' }, 503)
        : response({ ...chatMessage('retried-image', '图片'), type: 'image', attachment_url: options.data.attachment_url,
          client_message_id: options.data.client_message_id });
    }
    return response(options.method === 'GET' ? [] : {});
  };
  nodes(retrySendTree).find(node => node.type === 'Text' && node.props.children.includes('图片')).props.onClick();
  await flushCallbacks();
  retrySendTree = retrySendRenderer.render();
  action(retrySendTree, '重新发送').props.onClick();
  await flushCallbacks();
  retrySendTree = retrySendRenderer.render();
  check('image resend does not reupload an already uploaded attachment', () => assert.equal(retryUploads, 1));
  check('image resend preserves its message key and attachment metadata', () => assert.deepEqual(imageBodies[0], imageBodies[1]));
  check('image resend does not erase the current text draft', () => assert.equal(
    nodes(retrySendTree).find(node => node.type === 'Input').props.value, 'new draft to retain'));
  requestHandler = async options => options.method === 'POST' && options.url.endsWith('/messages')
    ? response({ detail: 'Temporary failure' }, 503) : response(options.method === 'GET' ? [] : {});
  action(retrySendTree, '发送').props.onClick();
  await flushCallbacks();
  check('new failure is kept until confirmed or account changes', () => assert.ok(hasText(retrySendRenderer.render(), '消息未确认发送')));
  session.setSession('retry-message-replacement-login', readyUser, 'refresh');
  retrySendRenderer.render();
  await flushCallbacks();
  check('same-account re-login clears old resend actions', () => assert.ok(!hasText(retrySendRenderer.render(), '消息未确认发送')));
  retrySendRenderer.unmount();

  const liveSendWait = deferred();
  let liveSendBody;
  requestHandler = async options => {
    if (options.method === 'POST' && options.url.endsWith('/messages')) { liveSendBody = options.data; return liveSendWait.promise; }
    return response(options.method === 'GET' ? [] : {});
  };
  const liveConfirmationRenderer = createRenderer(ThreadPage);
  liveConfirmationRenderer.render(); liveConfirmationRenderer.show(); liveConfirmationRenderer.render();
  await flushCallbacks();
  let liveConfirmationTree = liveConfirmationRenderer.render();
  nodes(liveConfirmationTree).find(node => node.type === 'Input').props.onInput({ detail: { value: 'confirmed before response' } });
  liveConfirmationTree = liveConfirmationRenderer.render();
  action(liveConfirmationTree, '发送').props.onClick();
  await flushCallbacks();
  const beforeLostResponse = toasts.length;
  sockets.at(-1).message({ data: JSON.stringify({ type: 'message', message: {
    ...chatMessage('live-confirmed-send', liveSendBody.content), client_message_id: liveSendBody.client_message_id,
  } }) });
  liveSendWait.reject(new Error('Response lost after persistence'));
  await flushCallbacks();
  liveConfirmationTree = liveConfirmationRenderer.render();
  check('live confirmation prevents a lost POST response from creating a false resend', () => {
    assert.ok(!hasText(liveConfirmationTree, '消息未确认发送'));
    assert.equal(toasts.length, beforeLostResponse);
  });
  check('confirmed delivery still clears only its own draft', () => assert.equal(
    nodes(liveConfirmationTree).find(node => node.type === 'Input').props.value, ''));
  liveConfirmationRenderer.unmount();
  check('new retry and context tests clean up timers and keyboard subscriptions', () => {
    assert.equal(chatIntervals.size, 0); assert.equal(keyboardListeners.size, 0);
  });
  intervals = { setInterval, clearInterval };
  routerParams = {};
  console.log(`PASS: ${checks.length} miniapp regression checks; no real API or account data used`);
})().catch(error => { console.error(error); process.exitCode = 1; });
