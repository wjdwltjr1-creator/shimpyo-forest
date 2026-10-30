// 옷장 아이템 목록 (서버·화면 공용). price 0 = 기본템, 그 외는 결제 준비 중이라 아직 못 산다.
const ITEMS = [
  { id: 'robe', slot: 'body', name: '승복', price: 0 },
  { id: 'shoes', slot: 'feet', name: '고무신', price: 0 },
  { id: 'earmuff', slot: 'head', name: '귀도리', price: 100 },
  { id: 'beanie', slot: 'head', name: '털모자', price: 100 }
];

if (typeof module !== 'undefined') module.exports = { ITEMS };
else window.ITEMS = ITEMS;
