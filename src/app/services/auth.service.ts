import { Injectable, signal, computed, effect } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from './supabase.service';
import { IndexedDBService } from './indexeddb.service';
import { UserProfile, AuthState } from '../models/database.model';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  // State signals
  private authState = signal<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true
  });

  // Public computed signals
  readonly currentUser = computed(() => this.authState().user);
  readonly isAuthenticated = computed(() => this.authState().isAuthenticated);
  readonly isLoading = computed(() => this.authState().isLoading);

  // Offline mode (when Supabase is not configured)
  private offlineMode = signal<boolean>(false);
  readonly isOfflineMode = computed(() => this.offlineMode());

  constructor(
    private supabase: SupabaseService,
    private indexedDB: IndexedDBService,
    private router: Router
  ) {
    this.initializeAuth();
  }

  private async initializeAuth(): Promise<void> {
    // Check if Supabase is configured
    if (!this.supabase.isConfigured()) {
      console.log('Supabase not configured. Offline mode available.');
      this.offlineMode.set(true);
      // Don't auto-login, just show login page with offline option
      this.authState.set({
        user: null,
        isAuthenticated: false,
        isLoading: false
      });
      return;
    }

    // Listen to auth state changes
    this.supabase.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const profile = await this.fetchProfile(session.user.id);
        this.authState.set({
          user: profile,
          isAuthenticated: true,
          isLoading: false
        });
      } else {
        this.authState.set({
          user: null,
          isAuthenticated: false,
          isLoading: false
        });
      }
    });

    // Check initial session
    const session = await this.supabase.getSession();
    if (session?.user) {
      const profile = await this.fetchProfile(session.user.id);
      this.authState.set({
        user: profile,
        isAuthenticated: true,
        isLoading: false
      });
    } else {
      this.authState.set({
        user: null,
        isAuthenticated: false,
        isLoading: false
      });
    }
  }

  private async fetchProfile(userId: string): Promise<UserProfile | null> {
    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) throw error;

      return {
        id: data.id,
        email: data.email,
        displayName: data.display_name,
        avatarUrl: data.avatar_url,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at)
      };
    } catch (error) {
      console.error('Error fetching profile:', error);
      return null;
    }
  }

  // ==================== AUTH METHODS ====================

  async signUp(email: string, password: string, displayName?: string): Promise<{ success: boolean; error?: string }> {
    if (this.offlineMode()) {
      return { success: false, error: 'Autenticación no disponible en modo offline' };
    }

    try {
      this.authState.update(state => ({ ...state, isLoading: true }));

      const { user, error } = await this.supabase.signUp(email, password);

      if (error) {
        this.authState.update(state => ({ ...state, isLoading: false }));
        return { success: false, error: error.message };
      }

      if (user) {
        // Update display name if provided
        if (displayName) {
          await this.supabase
            .from('profiles')
            .update({ display_name: displayName })
            .eq('id', user.id);
        }

        // Create default workspace for new user
        await this.createDefaultWorkspace(user.id);
      }

      return { success: true };
    } catch (error: any) {
      this.authState.update(state => ({ ...state, isLoading: false }));
      return { success: false, error: error.message };
    }
  }

  async signIn(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    if (this.offlineMode()) {
      return { success: false, error: 'Autenticación no disponible en modo offline' };
    }

    try {
      this.authState.update(state => ({ ...state, isLoading: true }));

      const { user, error } = await this.supabase.signIn(email, password);

      if (error) {
        this.authState.update(state => ({ ...state, isLoading: false }));
        return { success: false, error: this.translateError(error.message) };
      }

      return { success: true };
    } catch (error: any) {
      this.authState.update(state => ({ ...state, isLoading: false }));
      return { success: false, error: error.message };
    }
  }

  async signOut(): Promise<void> {
    if (this.offlineMode()) {
      return;
    }

    try {
      await this.supabase.signOut();
      this.router.navigate(['/login']);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  }

  /**
   * Continue in offline mode - explicitly called by user from login page
   */
  async continueOffline(): Promise<void> {
    if (!this.offlineMode()) {
      console.warn('continueOffline called but Supabase is configured');
      return;
    }

    // Create offline user
    const offlineUser: UserProfile = {
      id: 'offline-user',
      email: 'local@multidesktopflow.local',
      displayName: 'Usuario Local',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Ensure default workspace exists (skip pending change tracking)
    let workspace = await this.indexedDB.getDefaultWorkspace();
    if (!workspace) {
      workspace = await this.indexedDB.createWorkspace('Mi Workspace', true, true);
      // Create root desktop (skip pending change tracking)
      await this.indexedDB.createDesktop(workspace.id, 'Escritorio Principal', null, true);
    }

    this.authState.set({
      user: offlineUser,
      isAuthenticated: true,
      isLoading: false
    });
  }

  async resetPassword(email: string): Promise<{ success: boolean; error?: string }> {
    if (this.offlineMode()) {
      return { success: false, error: 'No disponible en modo offline' };
    }

    try {
      const { error } = await this.supabase.resetPassword(email);
      if (error) {
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ==================== PROFILE METHODS ====================

  async updateProfile(updates: Partial<UserProfile>): Promise<{ success: boolean; error?: string }> {
    const user = this.currentUser();
    if (!user) {
      return { success: false, error: 'No hay usuario autenticado' };
    }

    if (this.offlineMode()) {
      // Update local user
      this.authState.update(state => ({
        ...state,
        user: state.user ? { ...state.user, ...updates } : null
      }));
      return { success: true };
    }

    try {
      const { error } = await this.supabase
        .from('profiles')
        .update({
          display_name: updates.displayName,
          avatar_url: updates.avatarUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (error) {
        return { success: false, error: error.message };
      }

      // Update local state
      this.authState.update(state => ({
        ...state,
        user: state.user ? { ...state.user, ...updates } : null
      }));

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ==================== WORKSPACE METHODS ====================

  private async createDefaultWorkspace(userId: string): Promise<void> {
    try {
      // Create workspace in Supabase
      const { data: workspace, error: wsError } = await this.supabase
        .from('workspaces')
        .insert({
          user_id: userId,
          name: 'Mi Workspace',
          is_default: true,
          theme_config: {
            primaryColor: '#0d7337',
            glowIntensity: 0.7,
            particlesEnabled: true,
            animationsEnabled: true
          }
        })
        .select()
        .single();

      if (wsError) throw wsError;

      // Create root desktop
      const { error: dsError } = await this.supabase
        .from('desktops')
        .insert({
          workspace_id: workspace.id,
          name: 'Escritorio Principal',
          parent_id: null
        });

      if (dsError) throw dsError;
    } catch (error) {
      console.error('Error creating default workspace:', error);
    }
  }

  // ==================== HELPER METHODS ====================

  private translateError(message: string): string {
    const translations: Record<string, string> = {
      'Invalid login credentials': 'Credenciales inválidas',
      'Email not confirmed': 'Email no confirmado',
      'User already registered': 'Usuario ya registrado',
      'Password should be at least 6 characters': 'La contraseña debe tener al menos 6 caracteres',
      'Unable to validate email address: invalid format': 'Formato de email inválido'
    };
    return translations[message] || message;
  }

  // Check if can access app (must be authenticated, regardless of mode)
  canAccessApp(): boolean {
    return this.isAuthenticated();
  }
}
