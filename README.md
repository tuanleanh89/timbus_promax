# TÌM BUÝT PRO (HANOI BUS REALTIME)

Ứng dụng theo dõi xe buýt Hà Nội theo thời gian thực (Realtime GPS), tra cứu lộ trình và tự động cảnh báo khi xe đến gần điểm dừng.

## ✨ Điểm nổi bật & Tính năng đã hoàn thiện

1. **Hiển thị Realtime xe đang chạy trên bản đồ:**
   - Chọn bất kỳ tuyến nào trong **129 tuyến buýt Hà Nội**.
   - Vẽ lộ trình trực quan (đường Polyline màu nổi bật) cho cả **Chiều đi** và **Chiều về**.
   - Cập nhật liên tục vị trí các xe buýt đang hoạt động trên tuyến mỗi 5–6 giây (icon xe buýt sinh động, hiển thị biển kiểm soát, khoảng cách tới trạm kế tiếp).

2. **Tự động cảnh báo xe đến gần (Proximity Alert):**
   - Chọn trạm bạn đang đứng chờ xe (hoặc dùng nút định vị GPS để tự động chọn trạm gần nhất).
   - Thiết lập khoảng cách cảnh báo: 300m, 500m, 800m hoặc 1.2km.
   - Khi xe của tuyến bạn theo dõi tiến vào phạm vi:
     - 🔊 **Phát âm thanh chuông báo động** (Web Audio Chime).
     - 📳 **Rung điện thoại** (`Vibration API`).
     - 🔔 **Bắn thông báo Notification** trên màn hình.

3. **Giao diện tinh gọn, không quảng cáo:**
   - **Đã loại bỏ hoàn toàn chức năng "Tìm đường"** theo đúng yêu cầu.
   - Tập trung tối đa vào Bản đồ và Theo dõi xe.
   - Tốc độ tải tức thì, phản hồi 60fps, không giật lag.

4. **Hỗ trợ cài đặt như App Android Native (PWA Standalone):**
   - Hỗ trợ đầy đủ `manifest.json`, icon, Service Worker.
   - Khi mở trên điện thoại Android bằng trình duyệt Chrome, chỉ cần nhấn menu ba chấm -> chọn **"Thêm vào màn hình chính" (Add to Home screen / Cài đặt ứng dụng)**. App sẽ được cài vào máy như một app Android độc lập toàn màn hình (không có thanh URL).

---

## 🚀 Hướng dẫn khởi chạy

### Cách 1: Chạy bằng file 1-click
- Nhấp đúp vào file `start_app.bat` trong thư mục `timbuyt_new`.

### Cách 2: Chạy bằng lệnh Node.js
```bash
cd D:\Project_new\timbuyt\timbuyt_new
node server.js
```

### 📱 Cách truy cập:
- **Trên máy tính:** Truy cập [http://localhost:3000](http://localhost:3000)
- **Trên điện thoại Android (cùng mạng Wi-Fi):** Truy cập `http://10.39.37.245:3000` (hoặc IP máy tính của bạn).
- Bấm **"Cài đặt ứng dụng"** hoặc **"Thêm vào màn hình chính"** trên Chrome để đưa icon ra màn hình điện thoại dùng như app thông thường.
