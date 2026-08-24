import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import multer from 'multer';
import authRouter from './routes/auth.js';
import usuariosRouter from './routes/usuarios.js';
import postulacionesRouter from './routes/postulaciones.js';
import busquedasRouter from './routes/busquedas.js';
import candidatosRouter from './routes/candidatos.js';

const app = express();

// Railway (y cualquier PaaS) pone el server detrás de un proxy: sin esto,
// express-rate-limit y req.ip ven la IP del proxy en vez de la del cliente real
// (rompe el rate limiting de fuerza bruta y falsea la IP en los logs).
app.set('trust proxy', 1);

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/auth', authRouter);
app.use('/usuarios', usuariosRouter);
app.use('/postulaciones', postulacionesRouter);
app.use('/busquedas', busquedasRouter);
app.use('/candidatos', candidatosRouter);

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || /Solo se aceptan archivos/.test(err.message || '')) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: err.message || 'Error interno' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`SOCIUS API escuchando en http://localhost:${PORT}`));
