import { Injectable } from '@angular/core';
import { createClient, SupabaseClient, AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  private supabase: SupabaseClient;

  constructor() {
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
  }

  // ==================== CLIENT ACCESS ====================

  get client(): SupabaseClient {
    return this.supabase;
  }

  // ==================== AUTH METHODS ====================

  async signUp(email: string, password: string): Promise<{ user: User | null; error: Error | null }> {
    const { data, error } = await this.supabase.auth.signUp({
      email,
      password
    });
    return { user: data.user, error: error as Error | null };
  }

  async signIn(email: string, password: string): Promise<{ user: User | null; error: Error | null }> {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email,
      password
    });
    return { user: data.user, error: error as Error | null };
  }

  async signOut(): Promise<{ error: Error | null }> {
    const { error } = await this.supabase.auth.signOut();
    return { error: error as Error | null };
  }

  async getSession(): Promise<Session | null> {
    const { data } = await this.supabase.auth.getSession();
    return data.session;
  }

  async getUser(): Promise<User | null> {
    const { data } = await this.supabase.auth.getUser();
    return data.user;
  }

  async resetPassword(email: string): Promise<{ error: Error | null }> {
    const { error } = await this.supabase.auth.resetPasswordForEmail(email);
    return { error: error as Error | null };
  }

  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void) {
    return this.supabase.auth.onAuthStateChange(callback);
  }

  // ==================== DATABASE METHODS ====================

  from(table: string) {
    return this.supabase.from(table);
  }

  // ==================== STORAGE METHODS ====================

  async uploadFile(
    bucket: string,
    path: string,
    file: Blob | File,
    options?: { contentType?: string; upsert?: boolean }
  ): Promise<{ path: string | null; error: Error | null }> {
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .upload(path, file, {
        contentType: options?.contentType,
        upsert: options?.upsert ?? false
      });
    return { path: data?.path ?? null, error: error as Error | null };
  }

  getPublicUrl(bucket: string, path: string): string {
    const { data } = this.supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  async downloadFile(bucket: string, path: string): Promise<{ data: Blob | null; error: Error | null }> {
    const { data, error } = await this.supabase.storage.from(bucket).download(path);
    return { data, error: error as Error | null };
  }

  async deleteFile(bucket: string, paths: string[]): Promise<{ error: Error | null }> {
    const { error } = await this.supabase.storage.from(bucket).remove(paths);
    return { error: error as Error | null };
  }

  async listFiles(bucket: string, path?: string): Promise<{ files: any[] | null; error: Error | null }> {
    const { data, error } = await this.supabase.storage.from(bucket).list(path);
    return { files: data, error: error as Error | null };
  }

  // ==================== HELPER METHODS ====================

  isConfigured(): boolean {
    return (
      environment.supabase.url !== 'YOUR_SUPABASE_URL' &&
      environment.supabase.anonKey !== 'YOUR_SUPABASE_ANON_KEY'
    );
  }
}
