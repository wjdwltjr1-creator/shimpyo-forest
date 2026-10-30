// 채팅·소원·닉네임 거르기: 욕설은 ○로 가리고, 연락처·링크는 아예 지운다(개인정보 보호).

const BAD_WORDS = [
  // '보지 마'·'꺼져 가는 불'·'걸레'처럼 평범한 말과 겹치는 단어는 일부러 뺐다
  '시발', '씨발', '씨빨', '시빨', '씹새', '씹창', '쉬발', '슈발', '십새', '십알', 'ㅅㅂ', 'ㅆㅂ',
  '병신', '븅신', 'ㅂㅅ', '등신', '개새', '개색', '개세끼', '새끼', 'ㅅㄲ',
  '좆', '존나', 'ㅈㄴ', '지랄', 'ㅈㄹ', '염병', '엠창', '엿먹', '썅', '쌍놈', '쌍년',
  '미친놈', '미친년', '미친새', '또라이', '닥쳐', '닥치', '죽어라', '뒈져',
  '느금', '니애미', '느그애미', '니미럴', '애미', '애비', '패드립', '창녀',
  '섹스', '야동',
  '한남', '김치녀', '틀딱', '급식충', '맘충', '짱깨', '쪽바리', '흑형',
  'fuck', 'shit', 'bitch', 'asshole', 'dick', 'pussy', 'nigger', 'nigga', 'cunt', 'sex'
];

// 글자 사이에 넣은 공백·기호·숫자도 건너뛰고 잡는다 (예: 시 1 발)
const GAP = '[\\s\\d._\\-*~!@#$%^&()+=|/\\\\]*';
const BAD_REGEXES = BAD_WORDS.map((w) => {
  const chars = [...w.replace(/\s/g, '')].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(chars.join(GAP), 'gi');
});

const PERSONAL_PATTERNS = [
  /(https?:\/\/|www\.)\S+/gi,                         // 링크
  /\S+@\S+\.\S+/g,                                     // 이메일
  /(\+?\d[\d\s\-.]{7,}\d)/g,                           // 전화번호·긴 숫자
  /(카톡|카카오톡|오픈채팅|텔레|텔레그램|라인|인스타|디엠|dm)\s*(아이디|id)?\s*[:：]?\s*[a-z0-9_.]{3,}/gi
];

function clean(raw, maxLen) {
  let text = String(raw || '')
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁯﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
  let flagged = false;
  for (const re of PERSONAL_PATTERNS) {
    if (re.test(text)) { flagged = true; text = text.replace(re, '(가림)'); }
    re.lastIndex = 0;
  }
  for (const re of BAD_REGEXES) {
    text = text.replace(re, (m) => { flagged = true; return '○'.repeat(Math.min(m.length, 3)); });
  }
  return { text, flagged };
}

module.exports = { clean };
