'use strict';

// users/{uid} 는 손님이 「내 정보」에서 직접 고치는 문서이고, userPrivate/{uid} 는 관리자만 쓰는 문서다.
// 둘을 합칠 때는 관리자 문서가 이긴다. 다만 배송지는 관리자 쪽이 비어 있으면 손님이 넣은 값을 쓴다.
//
// 관리자가 주소 없이 업체를 먼저 등록하면 userPrivate 에 빈 배송지가 생긴다. 그 뒤 손님이 내 정보에서
// 주소를 넣으면 users.deliveryPlace 에만 들어가서, 빈 관리자 값에 가려 기사님 화면·카톡 목록에 주소가
// 나오지 않았다 (2026-11-25). 관리자가 회원 수정에서 저장하면 users 쪽 배송지는 지워지므로,
// users 에 배송지가 남아 있다는 것은 손님이 그 뒤에 넣었다는 뜻이다. 관리자 값이 있으면 그대로 관리자 값.
//
// 관리자 화면(admin.html 의 mergeUserPrivate)도 같은 규칙이다. 둘이 같게 합치는지 테스트가 대조한다.
//
// 주문 잠금 스냅숏(orderDefaultSnapshots)을 업체 정보 위에 얹을 때도 같은 규칙을 쓴다. 잠근 순간
// 배송지가 비어 있었으면 그 빈칸이 얼어서, 그날 하루 채운 배송지를 가렸다.

function blank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function mergeUserPrivate(user, priv) {
  const publicData = user || {};
  const privateData = priv || {};
  const merged = { ...publicData, ...privateData };
  // 주소와 상세주소는 한 묶음이다. 손님 주소를 쓰면 상세주소도 손님 것을 쓴다.
  if (blank(privateData.deliveryPlace) && !blank(publicData.deliveryPlace)) {
    merged.deliveryPlace = publicData.deliveryPlace;
    merged.deliveryPlaceDetail = publicData.deliveryPlaceDetail ?? '';
  }
  // 예전 문서는 배송지를 address 칸에 두었다.
  if (blank(privateData.address) && !blank(publicData.address)) merged.address = publicData.address;
  return merged;
}

module.exports = { mergeUserPrivate };
