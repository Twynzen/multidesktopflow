import { Injectable } from '@angular/core';
import { createClient, SupabaseClient, AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  private supabase: SupabaseClient | null = null;

  constructor() {
    // Only create client if properly configured
    if (this.isConfigured()) {
      this.supabase = createClient(
        environment.supabase.url,
        environment.supabase.anonKey,
        {
          auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true
          }
        }
      );
    } else {
      console.log('Supabase not configured. Running in offline mode.');
    }
  }

  // Check if Supabase is configured BEFORE creating client
  isConfigured(): boolean {
    const url = environment.supabase.url;
    const key = environment.supabase.anonKey;
    return (
      url !== '' &&
      url !== 'YOUR_SUPABASE_URL' &&
      key !== '' &&
      key !== 'YOUR_SUPABASE_ANON_KEY' &&
      url.startsWith('https://')
    );
  }

  // ==================== CLIENT ACCESS ====================

  get client(): SupabaseClient | null {
    return this.supabase;
  }

  // ==================== AUTH METHODS ====================

  async signUp(email: string, password: string): Promise<{ user: User | null; error: Error | null }> {
    if (!this.supabase) return { user: null, error: new Error('Supabase not configured') };
    const { data, error } = await this.supabase.auth.signUp({ email, password });
    return { user: data.user, error: error as Error | null };
  }

  async signIn(email: string, password: string): Promise<{ user: User | null; error: Error | null }> {
    if (!this.supabase) return { user: null, error: new Error('Supabase not configured') };
    const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
    return { user: data.user, error: error as Error | null };
  }

  async signOut(): Promise<{ error: Error | null }> {
    if (!this.supabase) return { error: null };
    const { error } = await this.supabase.auth.signOut();
    return { error: error as Error | null };
  }

  async getSession(): Promise<Session | null> {
    if (!this.supabase) return null;
    const { data } = await this.supabase.auth.getSession();
    return data.session;
  }

  async getUser(): Promise<User | null> {
    if (!this.supabase) return null;
    const { data } = await this.supabase.auth.getUser();
    return data.user;
  }

  async resetPassword(email: string): Promise<{ error: Error | null }> {
    if (!this.supabase) return { error: new Error('Supabase not configured') };
    const { error } = await this.supabase.auth.resetPasswordForEmail(email);
    return { error: error as Error | null };
  }

  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void) {
    if (!this.supabase) return { data: { subscription: { unsubscribe: () => {} } } };
    return this.supabase.auth.onAuthStateChange(callback);
  }

  // ==================== DATABASE METHODS ====================

  from(table: string) {
    if (!this.supabase) {
      throw new Error('Supabase not configured. Check isConfigured() before calling from()');
    }
    return this.supabase.from(table);
  }

  // ==================== STORAGE METHODS ====================

  async uploadFile(
    bucket: string,
    path: string,
    file: Blob | File,
    options?: { contentType?: string; upsert?: boolean }
  ): Promise<{ path: string | null; error: Error | null }> {
    if (!this.supabase) return { path: null, error: new Error('Supabase not configured') };
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .upload(path, file, {
        contentType: options?.contentType,
        upsert: options?.upsert ?? false
      });
    return { path: data?.path ?? null, error: error as Error | null };
  }

  getPublicUrl(bucket: string, path: string): string {
    if (!this.supabase) return '';
    const { data } = this.supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  async downloadFile(bucket: string, path: string): Promise<{ data: Blob | null; error: Error | null }> {
    if (!this.supabase) return { data: null, error: new Error('Supabase not configured') };
    const { data, error } = await this.supabase.storage.from(bucket).download(path);
    return { data, error: error as Error | null };
  }

  async deleteFile(bucket: string, paths: string[]): Promise<{ error: Error | null }> {
    if (!this.supabase) return { error: new Error('Supabase not configured') };
    const { error } = await this.supabase.storage.from(bucket).remove(paths);
    return { error: error as Error | null };
  }

  async listFiles(bucket: string, path?: string): Promise<{ files: any[] | null; error: Error | null }> {
    if (!this.supabase) return { files: null, error: new Error('Supabase not configured') };
    const { data, error } = await this.supabase.storage.from(bucket).list(path);
    return { files: data, error: error as Error | null };
  }
}
