// app.ts
import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { notFound } from './middleware/notfound.middleware';
import { errorHandler } from './middleware/error.middleware';
import authRouter from "./features/auth/auth.routes";
import userRoutes from "./features/users/users.routes"
import heroRoutes from './features/hero/hero.routes';
import newsRoutes from './features/news/news.routes';
import eventsRoutes from './features/events/events.routes';
import publicationsRoutes from './features/publications/publications.routes';
import documentsRoutes from './features/documents/documents.routes';
import judgesRoutes from './features/judges/judges.routes';
import { env } from './config/env';

const app: Application = express();

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ✅ Use the combined allowed origins from env
const allowedOrigins = env.ALLOWED_ORIGINS;

console.log('✅ Allowed CORS origins:', allowedOrigins);

// CORS Setup for Multiple Domains
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g., Postman, mobile apps, curl)
      if (!origin) {
        return callback(null, true);
      }

      // ✅ Check if origin is allowed
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // ✅ In development, allow all origins
      if (env.NODE_ENV === 'development') {
        return callback(null, true);
      }

      // ✅ Log blocked origins for debugging
      console.warn(`❌ CORS blocked: ${origin}`);
      return callback(new Error(`CORS policy: ${origin} is not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cookie'],
  })
);

// Health Check Route
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'success',
    message: 'Server is healthy',
    timestamp: new Date().toISOString(),
  });
});

// Routes
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/hero', heroRoutes);
app.use('/api/v1/news', newsRoutes);
app.use('/api/v1/events', eventsRoutes);
app.use('/api/v1/publications', publicationsRoutes);
app.use('/api/v1/documents', documentsRoutes);
app.use('/api/v1/judges', judgesRoutes);

// Error handlers
app.use(notFound);
app.use(errorHandler);

export default app;