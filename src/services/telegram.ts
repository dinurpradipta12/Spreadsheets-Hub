import { supabase } from '../lib/supabase';
import type { Workspace } from '../types';

export const DEFAULT_TELEGRAM_BOT_TOKEN = '8710369828:AAFbBonPYcXjp8-w0zQwEPV7n8DTHYV9S2o';
const TELEGRAM_API = `https://api.telegram.org/bot${DEFAULT_TELEGRAM_BOT_TOKEN}`;

let cachedChatId: string | null = null;
let isPollingActive = false;
let lastUpdateId = 0;

/**
 * Memuat Chat ID dari database / localStorage
 */
async function loadChatId(): Promise<string | null> {
  if (cachedChatId) return cachedChatId;

  // Cek localStorage dulu (paling cepat)
  const local = localStorage.getItem('telegram_chat_id');
  if (local) {
    cachedChatId = local;
    return local;
  }

  // Cek dari app_settings di Supabase
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'telegram_chat_id')
      .single();
    if (data?.value) {
      cachedChatId = data.value;
      localStorage.setItem('telegram_chat_id', data.value);
      return data.value;
    }
  } catch {
    // Ignore — table mungkin belum ada
  }

  return null;
}

/**
 * Menyimpan Telegram Chat ID ke app_settings & localStorage
 */
async function saveChatId(chatId: string) {
  cachedChatId = chatId;
  localStorage.setItem('telegram_chat_id', chatId);
  try {
    await supabase.from('app_settings').upsert(
      { key: 'telegram_chat_id', value: chatId },
      { onConflict: 'key' }
    );
  } catch (err) {
    console.warn('[Telegram] Gagal menyimpan chat_id ke DB:', err);
  }
}

/**
 * Panggil Telegram Bot API method
 */
async function callTelegram(method: string, params: Record<string, any>): Promise<any> {
  try {
    const res = await fetch(`${TELEGRAM_API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err) {
    console.error(`[Telegram] API call ${method} gagal:`, err);
    return { ok: false };
  }
}

/**
 * Mengirim pesan / notifikasi ke Telegram Bot
 */
export async function sendTelegramNotification(
  text: string,
  replyMarkup?: any,
  overrideChatId?: string
): Promise<boolean> {
  const targetChatId = overrideChatId || cachedChatId || await loadChatId();

  if (!targetChatId) {
    console.warn('[Telegram] Chat ID belum dikonfigurasi. Kirim /start ke @Confusheetsbot.');
    return false;
  }

  const params: Record<string, any> = {
    chat_id: targetChatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (replyMarkup) params.reply_markup = replyMarkup;

  const result = await callTelegram('sendMessage', params);
  if (!result.ok) {
    console.error('[Telegram] sendMessage gagal:', result);
  }
  return result.ok === true;
}

/**
 * Notifikasi saat Workspace Baru mendaftar / dibuat
 */
export async function notifyNewWorkspace(ws: Workspace) {
  const typeText = ws.is_trial ? '🎁 <b>TRIAL USER BARU</b>' : '🆕 <b>WORKSPACE BARU</b>';
  const subText = ws.subscription_ends_at
    ? `🗓 <b>Masa Aktif:</b> s/d ${new Date(ws.subscription_ends_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`
    : ws.trial_ends_at
      ? `⏱ <b>Trial Expired:</b> ${new Date(ws.trial_ends_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
      : '🗓 <b>Status:</b> Free / Belum Berlangganan';

  const text = `${typeText}\n\n` +
    `👤 <b>Pemilik:</b> ${ws.owner_name}\n` +
    `🔑 <b>Slug:</b> <code>${ws.slug}</code>\n` +
    `${subText}\n` +
    `📅 <b>Waktu Mendaftar:</b> ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}\n\n` +
    `<i>Gunakan tombol di bawah untuk mengelola workspace ini secara langsung:</i>`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '✅ Aktifkan (+1Bln)', callback_data: `tg_act:activate:${ws.id}` },
        { text: '🔴 Nonaktifkan', callback_data: `tg_act:toggle_active:${ws.id}` },
      ],
      [
        { text: ws.has_paid ? '💳 Status: Paid' : '💵 Set Paid', callback_data: `tg_act:toggle_paid:${ws.id}` },
        { text: '🗑 Hapus', callback_data: `tg_act:delete:${ws.id}` },
      ],
    ],
  };

  await sendTelegramNotification(text, inlineKeyboard);
}

/**
 * Notifikasi saat Google Sheet Baru dihubungkan di workspace
 */
export async function notifyNewSheet(wsOwnerName: string, clientName: string, title: string, platform?: string) {
  const text = `📊 <b>GOOGLE SHEET BARU DIHUBUNGKAN!</b>\n\n` +
    `🏢 <b>Workspace:</b> ${wsOwnerName}\n` +
    `🏷 <b>Klien / Brand:</b> ${clientName}\n` +
    `📌 <b>Judul Sheet:</b> ${title}\n` +
    `📱 <b>Platform:</b> ${platform || 'General'}\n` +
    `⏰ <b>Waktu:</b> ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;

  await sendTelegramNotification(text);
}

/**
 * Notifikasi saat langganan workspace diaktifkan / diperpanjang
 */
export async function notifySubscriptionActivated(ws: Workspace) {
  const text = `🎉 <b>LANGGANAN DIAKTIFKAN / DIPERPANJANG!</b>\n\n` +
    `👤 <b>Workspace:</b> ${ws.owner_name}\n` +
    `🔑 <b>Slug:</b> <code>${ws.slug}</code>\n` +
    `🗓 <b>Masa Aktif Baru:</b> s/d ${ws.subscription_ends_at ? new Date(ws.subscription_ends_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '1 Bulan'}\n` +
    `💳 <b>Status Payment:</b> Paid`;

  await sendTelegramNotification(text);
}

/**
 * Notifikasi saat workspace dinonaktifkan / revoked
 */
export async function notifyWorkspaceDeactivated(ws: Workspace) {
  const text = `⚠️ <b>WORKSPACE DINONAKTIFKAN!</b>\n\n` +
    `👤 <b>Workspace:</b> ${ws.owner_name}\n` +
    `🔑 <b>Slug:</b> <code>${ws.slug}</code>\n` +
    `📝 <b>Keterangan:</b> ${ws.revoke_reason || 'Akses ditangguhkan oleh developer.'}`;

  await sendTelegramNotification(text);
}

/**
 * 🤖 TELEGRAM BOT POLLING SERVICE & REMOTE COMMAND HANDLER
 */
export function startTelegramBotPoller() {
  if (isPollingActive) return;
  isPollingActive = true;
  console.log('[Telegram] Bot poller dimulai...');

  const poll = async () => {
    try {
      const url = `${TELEGRAM_API}/getUpdates?offset=${lastUpdateId + 1}&timeout=5`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.ok && Array.isArray(data.result) && data.result.length > 0) {
        for (const update of data.result) {
          lastUpdateId = update.update_id;
          try {
            await handleTelegramUpdate(update);
          } catch (err) {
            console.error('[Telegram] Error handling update:', err);
          }
        }
      }
    } catch (err) {
      console.error('[Telegram] Polling error:', err);
    } finally {
      if (isPollingActive) {
        setTimeout(poll, 3000);
      }
    }
  };

  poll();
}

/**
 * Memproses setiap pesan / command / callback button dari Telegram
 */
async function handleTelegramUpdate(update: any) {
  console.log('[Telegram] Received update:', JSON.stringify(update).substring(0, 200));

  // 1. Tangani Callback Query (klik Inline Button di Telegram)
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = String(cb.message.chat.id);
    const cbData = cb.data as string;

    if (cbData.startsWith('tg_act:')) {
      const parts = cbData.split(':');
      const action = parts[1];
      const wsId = parts[2];

      let resMsg = 'Aksi diproses.';
      try {
        const { data } = await supabase.rpc('process_telegram_action', {
          p_action: action,
          p_workspace_id: wsId,
        });
        if (data && (data as any[])[0]) {
          resMsg = (data as any[])[0].message;
        }
      } catch (err) {
        resMsg = `Error: ${err}`;
      }

      // Jawab Callback Query
      await callTelegram('answerCallbackQuery', {
        callback_query_id: cb.id,
        text: resMsg,
        show_alert: true,
      });

      // Kirim konfirmasi pesan
      await sendTelegramNotification(`⚡ <b>EKSEKUSI BOT:</b>\n${resMsg}`, undefined, chatId);
    }
    return;
  }

  // 2. Tangani Pesan Teks / Commands
  if (update.message && update.message.text) {
    const msg = update.message;
    const chatId = String(msg.chat.id);
    const text = (msg.text as string).trim();

    console.log(`[Telegram] Command dari chat ${chatId}: "${text}"`);

    // Auto-save Chat ID developer
    await saveChatId(chatId);

    // Command: /start atau /help
    if (text.startsWith('/start') || text.startsWith('/help')) {
      const helpMsg = `🤖 <b>HALAMAN CONTROL BOT - SPREADSHEETS HUB MANAGER</b>\n\n` +
        `Selamat datang Developer! Bot ini terhubung langsung ke dashboard Spreadsheets Hub.\n\n` +
        `<b>📋 Perintah Utama:</b>\n` +
        `• /stats - Ringkasan statistik realtime\n` +
        `• /workspaces - Daftar semua workspace & tombol kontrol\n\n` +
        `<b>⚡ Perintah Cepat:</b>\n` +
        `• <code>/activate [slug]</code> - Aktifkan + 1 bulan langganan\n` +
        `• <code>/extend [slug]</code> - Perpanjang langganan +1 bulan\n` +
        `• <code>/revoke [slug]</code> - Nonaktifkan workspace\n` +
        `• <code>/delete [slug]</code> - Hapus workspace\n\n` +
        `<i>Chat ID Anda (<code>${chatId}</code>) telah otomatis terhubung untuk menerima notifikasi!</i>`;

      const ok = await sendTelegramNotification(helpMsg, undefined, chatId);
      console.log(`[Telegram] /start response sent: ${ok}`);
      return;
    }

    // Command: /stats
    if (text.startsWith('/stats')) {
      try {
        const { data: wsList } = await supabase.from('workspaces').select('*');
        const list = (wsList as Workspace[]) || [];
        const total = list.length;
        const active = list.filter(w => w.is_active && (!w.subscription_ends_at || new Date(w.subscription_ends_at) >= new Date())).length;
        const revoked = list.filter(w => !w.is_active || (w.subscription_ends_at && new Date(w.subscription_ends_at) < new Date())).length;
        const paid = list.filter(w => w.has_paid).length;
        const trial = list.filter(w => w.is_trial).length;

        const statsMsg = `📊 <b>STATISTIK REALTIME SPREADSHEETS HUB</b>\n\n` +
          `🏢 <b>Total Workspace:</b> ${total}\n` +
          `🟢 <b>Aktif:</b> ${active}\n` +
          `🔴 <b>Revoked / Expired:</b> ${revoked}\n` +
          `💳 <b>Paid:</b> ${paid}\n` +
          `🎁 <b>Trial Users:</b> ${trial}\n\n` +
          `⏰ <i>Data diperbarui: ${new Date().toLocaleTimeString('id-ID')}</i>`;

        await sendTelegramNotification(statsMsg, undefined, chatId);
      } catch (err) {
        await sendTelegramNotification(`❌ Gagal memuat statistik: ${err}`, undefined, chatId);
      }
      return;
    }

    // Command: /workspaces atau /list
    if (text.startsWith('/workspaces') || text.startsWith('/list')) {
      try {
        const { data: wsList } = await supabase.from('workspaces').select('*').order('created_at', { ascending: false }).limit(10);
        const list = (wsList as Workspace[]) || [];

        if (list.length === 0) {
          await sendTelegramNotification('🏢 <i>Belum ada workspace yang mendaftar.</i>', undefined, chatId);
          return;
        }

        await sendTelegramNotification(`🏢 <b>DAFTAR WORKSPACE (10 Terakhir):</b>`, undefined, chatId);

        for (const ws of list) {
          const isSubExpired = ws.subscription_ends_at ? new Date(ws.subscription_ends_at) < new Date() : false;
          const isActive = ws.is_active && !isSubExpired;

          const itemMsg = `👤 <b>${ws.owner_name}</b> (<code>${ws.slug}</code>)\n` +
            `• Status: ${isActive ? '🟢 Active' : '🔴 Revoked / Expired'}\n` +
            `• Payment: ${ws.has_paid ? '💳 Paid' : '💵 Free'}\n` +
            `• Langganan: ${ws.subscription_ends_at ? new Date(ws.subscription_ends_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}`;

          const keyboard = {
            inline_keyboard: [
              [
                { text: '✅ +1Bln', callback_data: `tg_act:activate:${ws.id}` },
                { text: ws.is_active ? '🔴 Nonaktifkan' : '🟢 Aktifkan', callback_data: `tg_act:toggle_active:${ws.id}` },
              ],
              [
                { text: ws.has_paid ? '💳 Paid' : '💵 Set Paid', callback_data: `tg_act:toggle_paid:${ws.id}` },
                { text: '🗑 Hapus', callback_data: `tg_act:delete:${ws.id}` },
              ],
            ],
          };

          await sendTelegramNotification(itemMsg, keyboard, chatId);
        }
      } catch (err) {
        await sendTelegramNotification(`❌ Gagal memuat daftar workspace: ${err}`, undefined, chatId);
      }
      return;
    }

    // Command: /activate, /extend, /revoke, /delete [slug]
    const cmdMatch = text.match(/^\/(activate|extend|revoke|delete)\s+(.+)$/i);
    if (cmdMatch) {
      let action = cmdMatch[1].toLowerCase();
      if (action === 'revoke') action = 'toggle_active';
      const targetSlug = cmdMatch[2].trim();

      let resMsg = 'Aksi selesai.';
      try {
        const { data } = await supabase.rpc('process_telegram_action', {
          p_action: action,
          p_slug: targetSlug,
        });
        if (data && (data as any[])[0]) {
          resMsg = (data as any[])[0].message;
        }
      } catch (err) {
        resMsg = `Error: ${err}`;
      }
      await sendTelegramNotification(`⚡ <b>EKSEKUSI PERINTAH:</b>\n${resMsg}`, undefined, chatId);
      return;
    }

    // Pesan tidak dikenali
    await sendTelegramNotification(
      `❓ Perintah tidak dikenal. Ketik /help untuk melihat daftar perintah.`,
      undefined,
      chatId
    );
  }
}
