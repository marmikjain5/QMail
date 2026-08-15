export class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function mapSupabaseError(error, fallbackMessage = "Database operation failed.") {
  const message = error?.message || fallbackMessage;

  if (message.includes("schema cache") || message.includes("Could not find the table 'public.")) {
    return new AppError(
      "Supabase schema is missing. Apply `supabase/schema.sql` to your Supabase database, then restart the app.",
      500
    );
  }

  if (message.includes("relation") && message.includes("does not exist")) {
    return new AppError(
      "Required database tables do not exist. Apply `supabase/schema.sql` to your Supabase database, then restart the app.",
      500
    );
  }

  return new AppError(message, 500);
}
