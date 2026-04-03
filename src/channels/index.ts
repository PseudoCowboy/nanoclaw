// Channel self-registration barrel file.
// Each import triggers the channel module's registerChannel() call.
// Dynamic imports ensure missing optional dependencies (grammy, discord.js)
// don't crash the process — the channel is simply skipped.

export async function loadChannels(): Promise<void> {
  // discord
  try {
    await import('./discord.js');
  } catch {}

  // gmail

  // slack

  // telegram
  try {
    await import('./telegram.js');
  } catch {}

  // whatsapp
}
