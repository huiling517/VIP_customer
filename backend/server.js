import express from 'express';
import multer from 'multer';
import cors from 'cors';
import xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 8080;

// Fly.io 的持久化磁碟（volume）會掛載在這個路徑，資料存在這裡才不會在重新部署時消失
const DATA_DIR = process.env.DATA_DIR || '/data';
const DATA_FILE = path.join(DATA_DIR, 'guests.json');

// 上傳資料用的簡單密碼保護（不是完整帳號系統，但足以擋掉隨便亂傳的人）
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

// 允許哪個網址呼叫這個 API（部署到 Netlify 後填入實際網址，例如 https://xxxx.netlify.app）
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

// 確保資料夾與資料檔案存在
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, '[]', 'utf-8');
}

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

// 檔案先收到記憶體，不落地存檔，解析完就丟棄，避免佔用磁碟空間
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 最大 10MB
});

function checkAdminPassword(req, res, next) {
    const password = req.headers['x-admin-password'];
    if (!password || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: '密碼錯誤，無法上傳' });
    }
    next();
}

// 健康檢查，方便確認伺服器有沒有活著
app.get('/api/health', (req, res) => {
    res.json({ ok: true });
});

// 查詢頁面用這支 API 取得目前所有貴賓資料
app.get('/api/guests', (req, res) => {
    try {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        res.json(JSON.parse(raw));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '讀取資料失敗' });
    }
});

// 管理者上傳 Excel，後端解析後覆蓋整份資料
app.post('/api/upload', checkAdminPassword, upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: '未收到檔案' });
    }
    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        // defval: '' 讓空白儲存格轉成空字串，而不是被跳過
        const data = xlsx.utils.sheet_to_json(sheet, { defval: '' });

        if (!Array.isArray(data) || data.length === 0) {
            return res.status(400).json({ error: '這個 Excel 檔案讀不到任何資料' });
        }

        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
        res.json({ ok: true, count: data.length });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '解析 Excel 失敗，請確認檔案格式是否正確（.xlsx / .xls）' });
    }
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
