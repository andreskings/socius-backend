import { fileTypeFromFile } from 'file-type';
import fs from 'fs/promises';

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip', // .docx se detecta como zip por firma; se filtra por extensión igual
]);

const ALLOWED_EXT = new Set(['.pdf', '.doc', '.docx']);

// Valida el contenido real del archivo (magic bytes), no solo la extensión declarada
// por el cliente. Si no es válido, borra el archivo del disco y devuelve false.
export async function validateUploadedFile(filePath, originalName) {
  const ext = originalName.slice(originalName.lastIndexOf('.')).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    await fs.unlink(filePath).catch(() => {});
    return false;
  }

  const detected = await fileTypeFromFile(filePath);

  // .doc antiguo (formato OLE) no siempre es detectable por file-type; en ese caso
  // se acepta solo si la extensión coincide, ya que no tiene una firma moderna confiable.
  if (!detected) {
    if (ext === '.doc') return true;
    await fs.unlink(filePath).catch(() => {});
    return false;
  }

  if (!ALLOWED_MIMES.has(detected.mime)) {
    await fs.unlink(filePath).catch(() => {});
    return false;
  }

  return true;
}
