
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import xlsx from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const app = express();
const PORT = process.env.PORT || 8080;

// 上傳資料用的簡單密碼保護（不是完整帳號系統，但足以擋掉隨便亂傳的人）
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

// 允許哪個網址呼叫這個 API（部署到 Netlify 後填入實際網址，例如 https://xxxx.netlify.app）
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

// Supabase 連線設定（在 Supabase 專案的 Settings > API 頁面可以找到）
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY 環境變數，請先設定。');
}

// 這裡用 service role key，只在後端使用，絕對不能外流到前端或瀏覽器
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

// 檔案先收到記憶體，不落地存檔，解析完就丟棄
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
app.get('/api/guests', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('guests')
            .select('data')
            .order('id', { ascending: true });

        if (error) {
            throw error;
        }

        // 資料庫每一列存的是 { data: {...這一筆貴賓的完整欄位...} }，這裡把它攤平成陣列
        const guests = data.map(row => row.data);
        res.json(guests);
    } catch (err) {

        console.error(err);
        res.status(500).json({ error: '讀取資料失敗，請確認資料庫設定是否正確' });
    }
});

// 管理者上傳 Excel，後端解析後整批覆蓋 Supabase 裡的資料
app.post('/api/upload', checkAdminPassword, upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: '未收到檔案' });
    }
    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        // defval: '' 讓空白儲存格轉成空字串，而不是被跳過
        const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ error: '這個 Excel 檔案讀不到任何資料' });
        }

        // 先清空舊資料，id 是從 1 開始的自動編號，所以「大於 0」等於「全部」
        const { error: deleteError } = await supabase
            .from('guests')
            .delete()
            .gt('id', 0);

        if (deleteError) {
            throw deleteError;
        }

        // 再整批寫入新資料，每一列都包成 { data: {...這一筆的所有欄位...} }

        const rowsToInsert = rows.map(row => ({ data: row }));
        const { error: insertError } = await supabase
            .from('guests')
            .insert(rowsToInsert);

        if (insertError) {
            throw insertError;
        }

        res.json({ ok: true, count: rows.length });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '上傳失敗：' + (err.message || '請確認 Excel 格式與資料庫設定') });
    }
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
