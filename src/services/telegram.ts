import { supabase } from '../lib/supabase';
import type { Workspace } from '../types';

export const DEFAULT_TELEGRAM_BOT_TOKEN = '8710369828:AAFbBonPYcXjp8-w0zQwEPV7n8DTHYV9S2o';

let cachedBotToken: string | null = null;
let cachedChatId: string | null = null;
let isPollingActive = false;
let lastUpdateId = 0;

/**
 * Memuat Token Bot dan Chat ID dari database / settings
 */
export async function getTelegramConfig(): Promise<{ botToken: string; chatId: string | null }> {
  try {
    if (cachedBotToken && cachedChatId) {
      return { botToken: cachedBotToken, chatId: cachedChatId };
    }

    const { data } = await supabase.from('app_settings').select('key, value');
    let botToken = DEFAULT_TELEGRAM_BOT_TOKEN;
    let chatId = localStorage.getItem('telegram_chat_id') || null;

    if (data) {
      for (const row of data as { key: string; value: string }[]) {
        if (row.key === 'telegram_bot_token' && row.value?.trim()) {
          botToken = row.value.trim();
        }
        if (row.key === 'telegram_chat_id' && row.value?.trim()) {
          chatId = row.value.trim();
        }
      }
    }

    cachedBotToken = botToken;
    cachedChatId = chatId;
    return { botToken, chatId };
  } catch (err) {
    return { botToken: DEFAULT_TELEGRAM_BOT_TOKEN, chatId: localStorage.getItem('telegram_chat_id') };
  }
}

/**
 * Menyimpan Telegram Chat ID ke app_settings & localStorage
 */
export async function saveTelegramChatId(chatId: string) {
  cachedChatId = chatId;
  try {
    localStorage.setItem('telegram_chat_id', chatId);
    await supabase.rpc('save_app_settings', { p_settings: { telegram_chat_id: chatId } });
  } catch (err) {
    console.error('Error saving telegram chat id:', err);
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
  try {
    const { botToken, chatId } = await getTelegramConfig();
    const targetChatId = overrideChatId || chatId;

    if (!botToken || !targetChatId) {
      console.warn('Telegram Bot Token atau Chat ID belum dikonfigurasi.');
      return false;
    }

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: replyMarkup,
      }),
    });

    const data = await res.json();
    return data.ok === true;
  } catch (err) {
    console.error('Failed to send Telegram notification:', err);
    return false;
  }
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
 * Memungkinkan developer mengontrol aplikasi dari chat Telegram!
 */
export function startTelegramBotPoller() {
  if (isPollingActive) return;
  isPollingActive = true;

  const poll = async () => {
    try {
      const { botToken } = await getTelegramConfig();
      if (!botToken) return;

      const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=5`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.ok && Array.isArray(data.result) && data.result.length > 0) {
        for (const update of data.result) {
          lastUpdateId = update.update_id;
          await handleTelegramUpdate(update);
        }
      }
    } catch (err) {
      // Quiet poll error retry
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
  const { botToken } = await getTelegramConfig();

  // 1. Tangani Callback Query (klik Inline Button di Telegram)
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = String(cb.message.chat.id);
    const cbData = cb.data as string; // Contoh: tg_act:activate:uuid

    if (cbData.startsWith('tg_act:')) {
      const parts = cbData.split(':');
      const action = parts[1]; // activate, toggle_active, toggle_paid, delete
      const wsId = parts[2];

      const { data } = await supabase.rpc('process_telegram_action', {
        p_action: action,
        p_workspace_id: wsId,
      });

      let resMsg = 'Aksi diproses.';
      if (data && data[0]) {
        resMsg = data[0].message;
      }

      // Jawab Callback Query di Telegram (menampilkan popup singkat di chat)
      await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: cb.id, text: resMsg, show_alert: true }),
      });

      // Kirim konfirmasi pesan baru di chat
      await sendTelegramNotification(`⚡ <b>EKSEKUSI BOT:</b>\n${resMsg}`, null, chatId);
    }
    return;
  }

  // 2. Tangani Pesan Teks / Commands (/start, /stats, /workspaces, /activate slug)
  if (update.message && update.message.text) {
    const msg = update.message;
    const chatId = String(msg.chat.id);
    const text = (msg.text as string).trim();

    // Auto-save Chat ID developer saat pertama kali kirim pesan ke bot
    saveTelegramChatId(chatId);

    // Command: /start atau /help
    if (text.startsWith('/start') || text.startsWith('/help')) {
      const helpMsg = `🤖 <b>HALAMAN CONTROL BOT - SPREADSHEETS HUB MANAGER</b>\n\n` +
        `Selamat datang Developer! Bot ini terhubung langsung ke dashboard Spreadsheets Hub.\n\n` +
        `<b>📋 Perintah Utama:</b>\n` +
        `• /stats - Ringkasan statistik realtime\n` +
        `• /workspaces - Daftar semua workspace & tombol kontrol\n` +
        `• /trials - Daftar user trial & link demo\n\n` +
        `<b>⚡ Perintah Cepat:</b>\n` +
        `• <code>/activate [slug]</code> - Aktifkan + 1 bulan langganan\n` +
        `• <code>/extend [slug]</code> - Perpanjang langganan +1 bulan\n` +
        `• <code>/revoke [slug]</code> - Nonaktifkan workspace\n` +
        `• <code>/delete [slug]</code> - Hapus workspace\n\n` +
        `<i>Chat ID Anda (<code>${chatId}</code>) telah otomatis terhubung untuk menerima notifikasi!</i>`;

      await sendTelegramNotification(helpMsg, null, chatId);
      return;
    }

    // Command: /stats
    if (text.startsWith('/stats')) {
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

      await sendTelegramNotification(statsMsg, null, chatId);
      return;
    }

    // Command: /workspaces atau /list
    if (text.startsWith('/workspaces') || text.startsWith('/list')) {
      const { data: wsList } = await supabase.from('workspaces').select('*').order('created_at', { ascending: false }).limit(10);
      const list = (wsList as Workspace[]) || [];

      if (list.length === 0) {
        await sendTelegramNotification('🏢 <i>Belum ada workspace yang mendaftar.</i>', null, chatId);
        return;
      }

      await sendTelegramNotification(`🏢 <b>DAFTAR WORKSPACE (10 Terakhir):</b>`, null, chatId);

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
              { text: ws.has_paid ? '💳 Status: Paid' : '💵 Set Paid', callback_data: `tg_act:toggle_paid:${ws.id}` },
              { text: '🗑 Hapus', callback_data: `tg_act:delete:${ws.id}` },
            ],
          ],
        };

        await sendTelegramNotification(itemMsg, keyboard, chatId);
      }
      return;
    }

    // Command: /activate [slug] atau /extend [slug] atau /revoke [slug] atau /delete [slug]
    const cmdMatch = text.match(/^\/(activate|extend|revoke|delete)\s+(.+)$/i);
    if (cmdMatch) {
      let action = cmdMatch[1].toLowerCase();
      if (action === 'revoke') action = 'toggle_active';
      const targetSlug = cmdMatch[2].trim();

      const { data } = await supabase.rpc('process_telegram_action', {
        p_action: action,
        p_slug: targetSlug,
      });

      let resMsg = 'Aksi selesai.';
      if (data && data[0]) {
        resMsg = data[0].message;
      }
      await sendTelegramNotification(`⚡ <b>EKSEKUSI PERINTAH:</b>\n${resMsg}`, null, chatId);
      return;
    }
  }
}
