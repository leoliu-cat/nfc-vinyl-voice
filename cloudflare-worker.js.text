/**
 * 新架構：Cloudflare Worker (API) + R2 (音檔) + Neon Postgres (Metadata)
 * 
 * 部署與設定步驟：
 * 
 * 1. Cloudflare R2 設定：
 *    - 建立一個 R2 Bucket (例如名稱叫 `sharememori-audio`)
 *    - 在 Worker 的 Settings -> Bindings 新增一個 R2 Bucket binding
 *    - Variable name 填寫 `AUDIO_BUCKET` 並選擇剛剛建好的 Bucket
 * 
 * 2. Neon Database 設定：
 *    - 在 Neon 建立專案與資料庫
 *    - 在控制台執行以下 SQL 建立資料表：
 *      CREATE TABLE recordings (
 *        id VARCHAR(255) PRIMARY KEY,
 *        spotify_track_id VARCHAR(255),
 *        created_at TIMESTAMP DEFAULT NOW()
 *      );
 *    - 複製 Neon 提供的 Connection String (例如: postgresql://user:pass@ep-rest-of-host.region.aws.neon.tech/neondb)
 * 
 * 3. Worker 環境變數 (Settings -> Variables -> Secrets)：
 *    - 新增 `NEON_DATABASE_URL`，貼上 Neon 的 Connection String
 * 
 * 4. 在 Worker 裡需要安裝 neon 的 serverless 套件：
 *    - 若您在本地開發上傳，請先執行：npm install @neondatabase/serverless
 */

import { Client } from '@neondatabase/serverless';

export default {
  async fetch(request, env) {
    // 處理 CORS 預檢請求
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const { pathname } = new URL(request.url);
    const id = pathname.split('/').pop();

    try {
      // ==========================================
      // [R2 Storage] 音檔相關 API
      // ==========================================
      
      // 取得音檔
      if (request.method === "GET" && pathname.startsWith("/api/audio/")) {
        // Option 1: 給 R2 公開存取網址 (需要 Bucket 啟用 Public URL)
        // return new Response(JSON.stringify({ url: `https://pub-xxxxxx.r2.dev/${id}.mp4` }), { ... });
        
        // Option 2: 透過 Worker 直接回傳檔案內容 (較安全但耗費 Worker 記憶體)
        const object = await env.AUDIO_BUCKET.get(`${id}.mp4`);
        if (!object) return new Response("Not found", { status: 404 });
        
        // 將 Blob/File Buffer 直接回傳給前端
        return new Response(object.body, {
          headers: {
            "Content-Type": "audio/mp4",
            "Access-Control-Allow-Origin": "*",
          }
        });
      }

      // 上傳音檔
      if (request.method === "PUT" && pathname.startsWith("/api/audio/")) {
        // Cloudflare R2 原生 Binding 寫法，乾淨且快速
        await env.AUDIO_BUCKET.put(`${id}.mp4`, request.body, {
          httpMetadata: { contentType: 'audio/mp4' }
        });
        return new Response(null, { 
          status: 200,
          headers: { "Access-Control-Allow-Origin": "*" } 
        });
      }

      // 刪除音檔
      if (request.method === "DELETE" && pathname.startsWith("/api/audio/")) {
        await env.AUDIO_BUCKET.delete(`${id}.mp4`);
        return new Response(null, { 
          status: 200,
          headers: { "Access-Control-Allow-Origin": "*" } 
        });
      }

      // ==========================================
      // [Neon DB] Metadata 相關 API
      // ==========================================

      // 連線至 Neon Postgres
      const client = new Client(env.NEON_DATABASE_URL);
      await client.connect();

      // 上傳 / 更新 Metadata
      if (request.method === "PUT" && pathname.startsWith("/api/metadata/")) {
        const body = await request.json();
        const spotifyTrackId = body.spotifyTrackId;

        // 使用 UPSERT 語法 (如果 id 存在就更新 track_id，不存在就新增)
        await client.query(`
          INSERT INTO recordings (id, spotify_track_id)
          VALUES ($1, $2)
          ON CONFLICT (id) DO UPDATE 
          SET spotify_track_id = EXCLUDED.spotify_track_id
        `, [id, spotifyTrackId]);
        
        await client.end();
        return new Response(null, { 
          status: 200,
          headers: { "Access-Control-Allow-Origin": "*" } 
        });
      }

      // 取得 Metadata
      if (request.method === "GET" && pathname.startsWith("/api/metadata/")) {
        const res = await client.query('SELECT spotify_track_id FROM recordings WHERE id = $1', [id]);
        await client.end();

        if (res.rows.length === 0) {
          return new Response(JSON.stringify({}), {
            status: 200, // 不拋 404 防止前端報紅錯，回傳空資料
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }

        return new Response(JSON.stringify({ spotifyTrackId: res.rows[0].spotify_track_id }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }

      return new Response("Not Found", { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });

    } catch (e) {
      return new Response(e.message, { 
        status: 500,
        headers: { "Access-Control-Allow-Origin": "*" } 
      });
    }
  }
};
