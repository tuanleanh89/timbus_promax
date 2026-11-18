# Tìm Bus Promax

Ứng dụng cá nhân theo dõi xe buýt Hà Nội theo thời gian thực (dữ liệu từ timbus.vn), xem xe tiếp theo còn mấy phút tới trạm và báo khi xe sắp đến.

## Tính năng
- Bản đồ toàn màn hình với lộ trình chiều đi (xanh) / chiều về (cam), xe đang chạy cập nhật mỗi 4 giây.
- Chọn trạm (chạm chấm trạm, tìm kiếm, hoặc trạm đã lưu ★): hiện xe gần nhất, khoảng cách và số phút.
- Mở app là tự vào tuyến mặc định và trạm đã lưu đầu tiên.
- **Báo xe đến**: chuông, rung, thông báo, mô phỏng cuộc gọi + giọng nói khi xe cùng chiều còn cách trạm < N mét.
- **Canh xe xuất bến**: chạm vào xe trên bản đồ → "Canh xe này xuất bến".
- Service worker cache ô bản đồ, nên các khu vực đã xem mở lại tức thì.

## Chạy
```
node server.js
```
Hoặc nhấp đúp `start_app.bat`. Mở http://localhost:3000.

## Dùng trên điện thoại
**Qua Render (khuyên dùng):** app được deploy lên render.com, tự cập nhật mỗi lần push lên nhánh `main`. Địa chỉ `https://…onrender.com` có sẵn HTTPS nên GPS, thông báo và service worker chạy ngay, không cần cấu hình gì. Gói miễn phí của Render tắt server sau khoảng 15 phút không ai dùng, nên lần mở đầu có thể chờ 30–60 giây.

**Qua Wi-Fi nội bộ:** mở `http://<IP-máy-tính>:3000`. Lưu ý: Chrome chỉ cho **GPS, thông báo và service worker** chạy trên `https` hoặc `localhost`. Với địa chỉ IP nội bộ dạng `http://192.168…`, bật các tính năng này bằng cách:

1. Mở `chrome://flags/#unsafely-treat-insecure-origin-as-secure` trên điện thoại.
2. Nhập `http://<IP-máy-tính>:3000`, chọn **Enabled**, khởi động lại Chrome.
3. Menu ⋮ → **Thêm vào màn hình chính** để dùng như app.

Nếu không bật cờ này, app vẫn chạy (xem xe, chuông, rung, cuộc gọi mô phỏng), chỉ thiếu GPS và thông báo hệ thống.

## Cấu trúc
- `server.js`: API (`/api/search`, `/api/route/:code`, `/api/realtime/route/:code`, `/api/realtime/station/:id`, `/api/version`) và phục vụ file tĩnh.
- `public/geo.js`: hàm hình học dùng chung cho server và trình duyệt.
- `public/app.js`, `public/style.css`, `public/index.html`: giao diện.
- `public/sw.js`: service worker.
- `bus_data.json`, `fleet_83.json`: dữ liệu tuyến/trạm offline.
