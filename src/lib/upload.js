import multer from 'multer';
import path from 'path';

export const cvUpload = multer({
  storage: multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // busboy decode los nombres de archivo multipart como latin1 por defecto, pero
    // los navegadores los mandan en UTF-8 — sin esto, cualquier tilde/ñ queda como
    // mojibake ("VÃ­ctor" en vez de "Víctor") al guardarlo en la base de datos.
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ok = ['.pdf', '.doc', '.docx'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Solo se aceptan archivos PDF o Word'), ok);
  },
});
