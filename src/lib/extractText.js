import fs from 'fs/promises';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

const MAX_CHARS = 6000; // acota el texto enviado a Groq para controlar tokens/costo

// Extrae texto plano del CV para pasarlo a la IA. Devuelve null si el formato no
// tiene un parser confiable en este entorno (ej. .doc binario viejo).
export async function extraerTextoCv(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf') {
    const buffer = await fs.readFile(filePath);
    const parser = new PDFParse({ data: buffer });
    try {
      const resultado = await parser.getText();
      return resultado.text.slice(0, MAX_CHARS);
    } finally {
      await parser.destroy();
    }
  }

  if (ext === '.docx') {
    const resultado = await mammoth.extractRawText({ path: filePath });
    return resultado.value.slice(0, MAX_CHARS);
  }

  return null;
}
