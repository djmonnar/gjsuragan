(function () {
  'use strict';
  // 돌담명가 직원 운영 매뉴얼 — 예약장(reservations.html) 「📖 직원 매뉴얼」 탭에 보인다.
  // 원본: 사장님이 준 「돌담명가 직원 운영 매뉴얼」 한글 문서(2026-11). 레시피(주방 제2장~제5장)는 싣지 않는다.
  // 한국어(ko)와 베트남어(vi)는 같은 모양이어야 한다(테스트가 대조한다).
  // 베트남어에서 손님에게 하는 말(say)과 소스 이름은 한국어 원문(ko)을 같이 둔다. 손님은 한국 사람이라 그대로 읽어 주면 된다.
  //
  // 블록 종류
  //   list    { title?, items[] }                 점 목록
  //   flow    { title?, steps[] }                 화살표로 잇는 순서
  //   say     { title?, text, ko? }               손님에게 하는 말(따옴표 상자). vi 는 ko 에 한국어 원문
  //   cards   { title?, items[{ num, name, ko?, desc[] }] }  번호 카드(소스)
  //   note    { title?, text, items? }            꼭 지킬 것(강조 상자)
  //   table   { title?, head[], rows[][] }        표
  //   summary { title, rows[[label, value]], footer? }  한눈에 보기

  const SCRIPT_MEAT = '"고기는 마블링이 적은 부위부터 드시는 것을 추천드립니다. 담백한 맛부터 시작해서 마블링이 풍부한 부위로 드시면 한우의 고소한 풍미를 더욱 맛있게 즐기실 수 있습니다."';
  const SCRIPT_ALL = '"고기는 마블링이 적은 부위부터 드시면 담백한 맛부터 고소한 풍미까지 순서대로 즐기실 수 있습니다. 소스는 말돈소금, 야끼니꾸소스, 표고와사비, 명란 순서로 추천드립니다. 처음에는 말돈소금으로 고기 본연의 맛을 느껴보시고, 이후 다른 소스들도 고기 위에 조금씩 곁들여 드시면 더욱 다양한 풍미를 즐기실 수 있습니다."';

  const ko = {
    title: '돌담명가 직원 운영 매뉴얼',
    intro: '홀·주방 직원이 꼭 알아야 할 응대 순서와 근무 수칙입니다. 처음 오신 분은 위에서부터 한 번 읽어 주세요.',
    sections: [
      { id: 'service', icon: '🥩', label: '고객 응대', who: '홀', title: '고객 응대 · 고기와 소스 설명', blocks: [
        { type: 'list', title: '기본 응대 원칙', items: [
          '모든 고객에게 항상 밝고 친절한 태도로 응대합니다.',
          '고기를 낼 때는 더 맛있게 드시는 방법을 함께 안내합니다.',
          '설명은 자연스럽고 정중하게, 고객이 부담을 느끼지 않도록 합니다.'] },
        { type: 'flow', title: '고기 먹는 순서', steps: ['마블링이 적은 부위', '마블링이 많은 부위'] },
        { type: 'list', items: [
          '마블링이 적은 부위부터 드시면 고기 본연의 담백한 맛을 먼저 느낄 수 있습니다.',
          '이후 마블링이 풍부한 부위를 드시면 한우 특유의 고소함과 풍미를 더 잘 느낄 수 있습니다.'] },
        { type: 'say', title: '안내 멘트', text: SCRIPT_MEAT },
        { type: 'cards', title: '소스 안내 순서 — 꼭 이 순서로', items: [
          { num: '①', name: '말돈소금', desc: ['가장 먼저 추천하는 소스', '한우 본연의 맛과 풍미를 느낄 수 있게 안내합니다.'] },
          { num: '②', name: '야끼니꾸소스', desc: ['고기에 감칠맛을 더해 주는 소스', '한우의 풍미를 색다르게 즐길 수 있게 안내합니다.'] },
          { num: '③', name: '표고와사비', desc: ['표고버섯 향과 와사비의 알싸함이 특징', '고기의 고소함과 어울리게 즐기도록 안내합니다.'] },
          { num: '④', name: '명란', desc: ['명란 특유의 짭조름한 감칠맛이 특징', '고기와 함께 곁들여 드시도록 안내합니다.'] }] },
        { type: 'note', title: '소스 낼 때 주의', text: '소스는 찍어 먹는 것이 아니라, 고기 위에 조금씩 곁들여 드시도록 안내합니다.', items: [
          '소스를 과하게 쓰지 않도록 설명합니다.',
          '고기 본연의 맛을 해치지 않는 선에서 곁들이도록 추천합니다.',
          '고객의 취향을 존중하고 강요하지 않습니다.'] },
        { type: 'say', title: '한 번에 안내하는 멘트', text: SCRIPT_ALL },
        { type: 'summary', title: '홀 직원 필수 숙지', rows: [
          ['고기 순서', '마블링 적은 부위 → 마블링 많은 부위'],
          ['소스 순서', '말돈소금 → 야끼니꾸소스 → 표고와사비 → 명란'],
          ['서비스 핵심', '친절한 응대 · 정확한 설명 · 자연스러운 추천']],
        footer: '모든 홀 직원은 위 내용을 숙지하고 고객에게 일관된 서비스를 제공합니다.' }] },
      { id: 'hall', icon: '🛎', label: '홀 근무수칙', who: '홀', title: '홀 직원 근무수칙', blocks: [
        { type: 'flow', title: '주문 받는 순서 (필수)', steps: ['주문 접수', '문 닫기', '주방에 육성으로 주문 전달', '포스기 입력'] },
        { type: 'list', title: '① 주문을 받은 뒤 반드시 문 닫기', items: [
          '주문을 받고 객실에서 나올 때는 반드시 문을 닫습니다.',
          '문이 열린 채로 있지 않은지 항상 확인합니다.'] },
        { type: 'list', title: '② 주문 전달 순서 지키기', items: [
          '주문을 받으면 바로 주방에 먼저 육성으로(소리 내어) 전달합니다.',
          '주방에 전달한 뒤 포스기에 입력합니다.',
          '주문이 빠지거나 두 번 들어가지 않게 정확히 확인합니다.'] },
        { type: 'list', title: '소고기 주문 → 계란찜 서비스', items: [
          '소고기를 주문한 고객에게 계란찜을 서비스로 드립니다.',
          '빠뜨리지 않도록 반드시 확인합니다.'] },
        { type: 'list', title: '리뷰 이벤트 서비스', items: [
          '리뷰 작성이 끝난 것을 확인한 뒤에 드립니다.',
          '「쓰겠다」는 약속만으로 먼저 드리지 않습니다.',
          '리뷰 작성 화면을 직접 확인한 뒤 드립니다.',
          '서비스만 받고 리뷰를 쓰지 않는 일이 없도록 주의합니다.'] },
        { type: 'note', text: '리뷰 서비스는 작성이 끝난 화면을 확인한 다음에 드립니다.' }] },
      { id: 'pay', icon: '💳', label: '계산·정산', who: '홀', title: '계산 · 정산', blocks: [
        { type: 'list', title: '① 미수금', items: [
          '미수금이 생기면 금액을 테이프에 적습니다.',
          '적은 테이프는 TV에 붙여 직원 모두가 볼 수 있게 합니다.',
          '미수금이 빠지지 않게 정확히 관리합니다.'] },
        { type: 'list', title: '② 상품권 발행', items: [
          '상품권을 발행할 때는 반드시 발행 날짜와 금액을 적습니다.',
          '날짜나 금액이 빠진 상품권이 없게 확인합니다.'] },
        { type: 'table', title: '③ 결제수단별 포스기 정산', head: ['결제수단', '포스기 정산'], rows: [
          ['실물 현금', '현금으로 정산'],
          ['일반 신용카드', '실제 카드 승인 내역대로 정산'],
          ['그 밖의 결제', '포스기에서 신용카드 임의등록 → 기타카드로 정산']] },
        { type: 'note', text: '실물 현금을 뺀 그 밖의 결제는 모두 「신용카드 임의등록 → 기타카드」로 정산합니다.' }] },
      { id: 'kitchen', icon: '🍳', label: '주방 근무수칙', who: '주방', title: '주방 직원 근무수칙', blocks: [
        { type: 'flow', title: '주방 핵심 순서', steps: ['주문 확인', '육성 대답', '주문서 확인', '바로 조리', '간 확인', '음식 제공'] },
        { type: 'list', title: '① 주문 받고 조리 시작', items: [
          '홀 직원이 육성으로 주문을 전하면 반드시 확인 대답을 합니다.',
          '육성 주문을 받으면 바로 주문서를 확인합니다.',
          '주문서의 메뉴와 수량을 확인한 뒤 바로 조리를 시작합니다.',
          '늘 분명하게 대답해서 주문이 빠지지 않게 합니다.'] },
        { type: 'list', title: '② 음식 맛 확인', items: [
          '모든 음식은 내기 전에 반드시 간을 봅니다.',
          '맛과 완성 상태를 확인한 뒤 홀 직원에게 넘깁니다.',
          '만들 때마다 같은 맛과 품질을 유지합니다.',
          '간을 볼 때는 깨끗한 별도 시식 도구를 씁니다.'] }] },
    ],
  };

  const vi = {
    title: 'Sổ tay vận hành nhân viên 돌담명가',
    intro: 'Thứ tự tiếp khách và quy tắc làm việc mà nhân viên sảnh và bếp cần nắm. Nếu bạn mới vào làm, hãy đọc một lượt từ trên xuống.',
    sections: [
      { id: 'service', icon: '🥩', label: 'Tiếp khách', who: 'Sảnh', title: 'Tiếp khách · Giới thiệu thịt và nước chấm', blocks: [
        { type: 'list', title: 'Nguyên tắc tiếp khách cơ bản', items: [
          'Luôn tiếp đón mọi khách hàng với thái độ vui vẻ, thân thiện.',
          'Khi mang thịt ra, hướng dẫn khách cách ăn để thịt ngon hơn.',
          'Giải thích tự nhiên, lịch sự, không làm khách cảm thấy bị ép.'] },
        { type: 'flow', title: 'Thứ tự ăn thịt', steps: ['Phần ít vân mỡ (마블링 적은 부위)', 'Phần nhiều vân mỡ (마블링 많은 부위)'] },
        { type: 'list', items: [
          'Ăn phần ít vân mỡ trước sẽ cảm nhận được vị thanh, tự nhiên của thịt.',
          'Sau đó ăn phần nhiều vân mỡ sẽ cảm nhận rõ hơn vị béo thơm đặc trưng của bò Hanwoo.'] },
        { type: 'say', title: 'Câu nói với khách', ko: SCRIPT_MEAT,
          text: '"Chúng tôi khuyên quý khách ăn từ phần ít vân mỡ trước. Bắt đầu từ vị thanh rồi chuyển sang phần nhiều vân mỡ, quý khách sẽ thưởng thức trọn vị béo thơm của bò Hanwoo."' },
        { type: 'cards', title: 'Thứ tự giới thiệu nước chấm — luôn theo thứ tự này', items: [
          { num: '①', name: 'Muối Maldon', ko: '말돈소금', desc: ['Loại được giới thiệu đầu tiên', 'Giúp khách cảm nhận vị nguyên bản của bò Hanwoo.'] },
          { num: '②', name: 'Sốt Yakiniku', ko: '야끼니꾸소스', desc: ['Làm thịt thêm đậm đà (vị umami)', 'Giúp khách thưởng thức bò Hanwoo theo một cách khác.'] },
          { num: '③', name: 'Wasabi nấm hương', ko: '표고와사비', desc: ['Đặc trưng: mùi thơm nấm hương và vị cay nồng của wasabi', 'Hướng dẫn khách ăn kèm cho hợp với vị béo của thịt.'] },
          { num: '④', name: 'Trứng cá minh thái', ko: '명란', desc: ['Đặc trưng: vị mặn mặn, đậm đà của trứng cá minh thái', 'Hướng dẫn khách ăn kèm cùng thịt.'] }] },
        { type: 'note', title: 'Lưu ý khi đưa nước chấm', text: 'Không chấm ngập — chỉ đặt một ít nước chấm lên miếng thịt.', items: [
          'Giải thích để khách không dùng quá nhiều nước chấm.',
          'Khuyên khách dùng vừa đủ để không làm mất vị thịt.',
          'Tôn trọng sở thích của khách, không ép buộc.'] },
        { type: 'say', title: 'Câu giới thiệu đầy đủ', ko: SCRIPT_ALL,
          text: '"Quý khách ăn từ phần ít vân mỡ trước thì sẽ lần lượt thưởng thức từ vị thanh đến vị béo thơm. Nước chấm chúng tôi gợi ý theo thứ tự: muối Maldon, sốt Yakiniku, wasabi nấm hương, trứng cá minh thái. Lúc đầu quý khách thử với muối Maldon để cảm nhận vị nguyên bản của thịt, sau đó đặt một ít các loại nước chấm khác lên thịt để thưởng thức nhiều hương vị hơn."' },
        { type: 'summary', title: 'Nhân viên sảnh phải nhớ', rows: [
          ['Thứ tự thịt', 'Ít vân mỡ → Nhiều vân mỡ'],
          ['Thứ tự nước chấm', 'Muối Maldon (말돈소금) → Sốt Yakiniku (야끼니꾸소스) → Wasabi nấm hương (표고와사비) → Trứng cá minh thái (명란)'],
          ['Cốt lõi phục vụ', 'Thân thiện · Giải thích chính xác · Gợi ý tự nhiên']],
        footer: 'Tất cả nhân viên sảnh phải nắm vững nội dung trên để phục vụ khách một cách đồng nhất.' }] },
      { id: 'hall', icon: '🛎', label: 'Quy tắc sảnh', who: 'Sảnh', title: 'Quy tắc làm việc của nhân viên sảnh', blocks: [
        { type: 'flow', title: 'Thứ tự nhận order (bắt buộc)', steps: ['Nhận order', 'Đóng cửa phòng', 'Nói to order cho bếp', 'Nhập vào máy POS'] },
        { type: 'list', title: '① Nhận order xong phải đóng cửa', items: [
          'Khi nhận order xong và ra khỏi phòng, nhất định phải đóng cửa.',
          'Luôn kiểm tra để cửa không bị bỏ mở.'] },
        { type: 'list', title: '② Đúng thứ tự chuyển order', items: [
          'Nhận order xong, việc đầu tiên là nói to (bằng lời) cho bếp biết.',
          'Báo bếp xong mới nhập order vào máy POS.',
          'Kiểm tra kỹ để order không bị sót hay bị nhập trùng.'] },
        { type: 'list', title: 'Gọi thịt bò → tặng trứng hấp (계란찜)', items: [
          'Khách gọi thịt bò được tặng món trứng hấp (계란찜).',
          'Nhất định kiểm tra để không quên tặng.'] },
        { type: 'list', title: 'Quà tặng sự kiện đánh giá (리뷰 이벤트)', items: [
          'Chỉ tặng sau khi xác nhận khách đã viết xong đánh giá.',
          'Không tặng trước chỉ vì khách hứa "sẽ viết".',
          'Xem tận mắt màn hình đánh giá đã đăng rồi mới tặng.',
          'Chú ý để không có trường hợp khách nhận quà mà không viết đánh giá.'] },
        { type: 'note', text: 'Quà đánh giá: xem màn hình đã đăng xong rồi mới tặng.' }] },
      { id: 'pay', icon: '💳', label: 'Tính tiền', who: 'Sảnh', title: 'Tính tiền · Quyết toán', blocks: [
        { type: 'list', title: '① Tiền khách còn nợ (미수금)', items: [
          'Khi có khoản khách chưa trả, ghi số tiền lên băng dính.',
          'Dán băng dính đó lên TV để mọi nhân viên đều thấy.',
          'Quản lý chính xác để không bỏ sót khoản nợ nào.'] },
        { type: 'list', title: '② Phát hành phiếu quà tặng (상품권)', items: [
          'Khi phát hành phiếu quà tặng, nhất định ghi ngày phát hành và số tiền.',
          'Kiểm tra để không có phiếu nào thiếu ngày hoặc số tiền.'] },
        { type: 'table', title: '③ Quyết toán trên máy POS theo cách thanh toán', head: ['Cách thanh toán', 'Quyết toán trên POS'], rows: [
          ['Tiền mặt thật', 'Quyết toán là tiền mặt'],
          ['Thẻ tín dụng thông thường', 'Theo đúng giao dịch thẻ đã được duyệt'],
          ['Các cách thanh toán khác', 'Trên POS: nhập thẻ tín dụng thủ công (신용카드 임의등록) → quyết toán là thẻ khác (기타카드)']] },
        { type: 'note', text: 'Ngoài tiền mặt thật, mọi cách thanh toán khác đều quyết toán bằng "nhập thẻ thủ công → thẻ khác (기타카드)".' }] },
      { id: 'kitchen', icon: '🍳', label: 'Quy tắc bếp', who: 'Bếp', title: 'Quy tắc làm việc của nhân viên bếp', blocks: [
        { type: 'flow', title: 'Thứ tự cốt lõi của bếp', steps: ['Nghe order', 'Trả lời to', 'Xem phiếu order', 'Nấu ngay', 'Nếm vị', 'Ra món'] },
        { type: 'list', title: '① Nhận order và bắt đầu nấu', items: [
          'Khi nhân viên sảnh nói to order, nhất định phải trả lời xác nhận.',
          'Nghe order xong thì xem ngay phiếu order.',
          'Kiểm tra món và số lượng trên phiếu rồi bắt đầu nấu ngay.',
          'Luôn trả lời rõ ràng để không sót order.'] },
        { type: 'list', title: '② Kiểm tra vị món ăn', items: [
          'Món nào cũng phải nếm vị trước khi đưa ra.',
          'Kiểm tra vị và độ hoàn thiện rồi mới giao cho nhân viên sảnh.',
          'Mỗi lần nấu đều giữ đúng một vị và chất lượng.',
          'Khi nếm, dùng dụng cụ nếm riêng, sạch sẽ.'] }] },
    ],
  };

  const guide = { ko, vi };
  if (typeof module === 'object' && module.exports) module.exports = guide;
  if (typeof window === 'object') window.ReservationGuide = guide;
})();
