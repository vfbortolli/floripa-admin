// modules/db.js - Cliente Supabase e gerenciamento de comprovantes

let db = null;

export const createDbClient = () => {
  const { createClient } = window.supabase;
  const cfg = window.APP_CONFIG;
  db = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  return db;
};

export const getDb = () => db;

const PAYMENT_PROOFS_BUCKET = "payment-proofs";
const PAYMENT_PROOF_TYPES = new Map([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
]);
const PAYMENT_PROOF_MAX_SIZE = 10 * 1024 * 1024;

export { PAYMENT_PROOFS_BUCKET, PAYMENT_PROOF_TYPES, PAYMENT_PROOF_MAX_SIZE };

export const uploadPaymentProof = async (file) => {
  const extension = PAYMENT_PROOF_TYPES.get(file.type);
  if (!extension) return { error: "Use um comprovante em PDF, JPG ou PNG." };
  if (!file.size || file.size > PAYMENT_PROOF_MAX_SIZE) {
    return { error: "O arquivo deve ter até 10 MB." };
  }
  const objectPath = `${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await db.storage.from(PAYMENT_PROOFS_BUCKET)
    .upload(objectPath, file, { contentType: file.type, upsert: false });
  if (uploadError) return { error: uploadError.message };

  const originalName = file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 120) || "comprovante";
  const { data, error } = await db.from("payment_receipts")
    .insert({ object_path: objectPath, original_name: originalName })
    .select("id, object_path, original_name, uploaded_at")
    .single();
  if (error) {
    const { error: cleanupError } = await db.storage.from(PAYMENT_PROOFS_BUCKET).remove([objectPath]);
    return {
      error: cleanupError
        ? `${error.message} O arquivo enviado não pôde ser removido do armazenamento: ${cleanupError.message}`
        : error.message,
    };
  }
  return { data };
};

export const cleanupUnlinkedPaymentProof = async (receipt) => {
  const { error: recordError } = await db.from("payment_receipts").delete().eq("id", receipt.id);
  const { error: fileError } = await db.storage.from(PAYMENT_PROOFS_BUCKET).remove([receipt.object_path]);
  return [recordError, fileError].filter(Boolean).map((error) => error.message);
};

// Remove o registro (vínculos caem em cascata; o banco bloqueia se houver baixa) e depois o arquivo.
export const deletePaymentProof = async (receipt) => {
  const { error } = await db.from("payment_receipts").delete().eq("id", receipt.id);
  if (error) return { error: error.message };
  const { error: fileError } = await db.storage.from(PAYMENT_PROOFS_BUCKET).remove([receipt.object_path]);
  return { error: fileError ? `Registro removido, mas o arquivo não: ${fileError.message}` : null };
};

export const openPaymentProof = async (receipt, messageId) => {
  const { say } = await import("./ui.js");
  const { $ } = await import("./dom.js");
  const tab = window.open("about:blank", "_blank");
  if (!tab) return say(messageId, "Permita abrir uma nova aba para visualizar o comprovante.");
  tab.opener = null;
  const { data, error } = await db.storage.from(PAYMENT_PROOFS_BUCKET)
    .createSignedUrl(receipt.object_path, 60);
  if (error) {
    tab.close();
    return say(messageId, error.message);
  }
  tab.location.href = data.signedUrl;
};
