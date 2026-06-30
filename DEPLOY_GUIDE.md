# Hướng dẫn Deploy Rewards Decision OS lên Vercel

## Cấu trúc thư mục

```
rewards-os-deploy/
├── api/
│   └── chat.js          ← Proxy server, giữ API key an toàn
├── public/
│   └── index.html       ← App chính (Rewards Decision OS)
├── vercel.json           ← Config Vercel
├── package.json
└── .gitignore
```

## Bước 1 — Cài Vercel CLI (nếu chưa có)

```bash
npm install -g vercel
```

## Bước 2 — Đăng nhập Vercel

```bash
vercel login
```

## Bước 3 — Deploy lần đầu

Từ trong thư mục `rewards-os-deploy`, chạy:

```bash
vercel
```

Trả lời các câu hỏi:
- Set up and deploy? → **Yes**
- Which scope? → chọn account của bạn
- Link to existing project? → **No**
- Project name? → đặt tên, ví dụ `rewards-decision-os`
- Directory? → **./` (giữ mặc định)
- Override settings? → **No**

Vercel sẽ deploy và cho bạn một URL dạng `https://rewards-decision-os-xxxxx.vercel.app`

## Bước 4 — QUAN TRỌNG: Thêm API key (KHÔNG bỏ qua bước này)

App sẽ KHÔNG hoạt động nếu thiếu bước này. Có 2 cách:

### Cách A — Qua Vercel Dashboard (dễ nhất)
1. Vào https://vercel.com/dashboard
2. Chọn project vừa tạo
3. Vào tab **Settings** → **Environment Variables**
4. Thêm:
   - Name: `ANTHROPIC_API_KEY`
   - Value: (API key của bạn, lấy tại https://console.anthropic.com/settings/keys)
   - Environment: chọn cả Production, Preview, Development
5. Bấm **Save**

### Cách B — Qua CLI
```bash
vercel env add ANTHROPIC_API_KEY
```
Sau đó paste API key khi được hỏi, chọn cả 3 environment.

## Bước 5 — Deploy lại để áp dụng environment variable

```bash
vercel --prod
```

Lệnh này deploy lên production với domain chính thức (không phải preview URL).

## Bước 6 — Test thử

Mở URL production, gõ một câu hỏi vào chat. Nếu app phản hồi được — bạn đã setup đúng. Nếu lỗi, xem mục Troubleshooting dưới.

## Bước 7 — Lấy link để gửi cho bạn bè

Sau khi deploy production thành công, Vercel cho bạn một domain cố định dạng:
`https://rewards-decision-os.vercel.app` (hoặc tên bạn đặt)

Đây là link bạn gửi cho bạn bè test.

---

## Cách thu thập case studies từ bạn bè

App đã có sẵn nút **"Sao chép case để gửi feedback"** xuất hiện sau khi họ chat ít nhất 1 lượt. Khi bấm:
- Toàn bộ cuộc hội thoại được copy vào clipboard kèm 3 câu hỏi phản hồi
- Bạn bè chỉ cần paste vào Zalo/Messenger/email gửi cho bạn

Gợi ý hướng dẫn ngắn gửi kèm link cho bạn bè:

> "Mình đang xây một AI tư vấn về lương thưởng. Bạn thử mô tả một vấn đề nhân sự thật mà công ty bạn đang gặp xem AI tư vấn thế nào nhé. Sau khi chat xong, bấm nút 'Sao chép case để gửi feedback' ở cuối trang, rồi gửi lại cho mình qua đây. Cảm ơn bạn nhiều!"

---

## Troubleshooting

**App load được nhưng chat không phản hồi, hoặc lỗi:**
- Kiểm tra lại đã thêm `ANTHROPIC_API_KEY` đúng chưa (Bước 4)
- Vào Vercel Dashboard → project → tab **Logs** để xem lỗi cụ thể từ server

**Lỗi "Quá nhiều yêu cầu" xuất hiện dù mới dùng:**
- Đây là rate limit bảo vệ (10 request/phút/IP) — nếu bạn đang test nhanh liên tục, chờ 1 phút

**Muốn tăng giới hạn rate limit:**
- Mở file `api/chat.js`, sửa số `RATE_LIMIT_MAX_REQUESTS = 10` thành số lớn hơn, deploy lại

**Lưu case không hoạt động / mất khi đổi máy:**
- Đây là thiết kế có chủ đích: case được lưu trên `localStorage` của từng trình duyệt, không đồng bộ giữa các máy. Phù hợp cho giai đoạn test với bạn bè. Khi lên production thật sẽ cần database (xem lại kế hoạch tổng thể đã thảo luận).

## Chi phí

- Vercel hosting: miễn phí cho mức dùng thử (hobby plan)
- Anthropic API: tính theo token thực tế sử dụng — với khoảng 10-20 người bạn test, vài chục cuộc hội thoại, chi phí dự kiến vài USD, không đáng kể
- Theo dõi chi phí tại: https://console.anthropic.com/settings/billing
