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
    console.log('[AuthService] 🚀 initializeAuth() started');

    try {
      // Check if Supabase is configured
      if (!this.supabase.isConfigured()) {
        console.log('[AuthService] ⚠️ Supabase not configured. Offline mode available.');
        this.offlineMode.set(true);
        this.authState.set({
          user: null,
          isAuthenticated: false,
          isLoading: false
        });
        console.log('[AuthService] ✅ Offline mode set, isLoading: false');
        return;
      }

      console.log('[AuthService] 📡 Supabase is configured, setting up auth listener...');

      // Listen to auth state changes
      this.supabase.onAuthStateChange(async (event, session) => {
        console.log(`[AuthService] 🔔 onAuthStateChange event: ${event}`, { hasSession: !!session, hasUser: !!session?.user });

        try {
          if (session?.user) {
            console.log(`[AuthService] 👤 User found in session: ${session.user.email}`);
            const profile = await this.fetchProfile(session.user.id, session.user.email);
            console.log('[AuthService] 📋 Profile fetched:', { hasProfile: !!profile, displayName: profile?.displayName });

            this.authState.set({
              user: profile,
              isAuthenticated: !!profile,
              isLoading: false
            });
            console.log('[AuthService] ✅ Auth state updated from listener, isAuthenticated:', !!profile);
          } else {
            console.log('[AuthService] 👻 No user in session from listener');
            this.authState.set({
              user: null,
              isAuthenticated: false,
              isLoading: false
            });
            console.log('[AuthService] ✅ Auth state cleared from listener');
          }
        } catch (listenerError) {
          console.error('[AuthService] ❌ Error in onAuthStateChange listener:', listenerError);
          this.authState.set({
            user: null,
            isAuthenticated: false,
            isLoading: false
          });
        }
      });

      // Check initial session
      console.log('[AuthService] 🔍 Checking initial session...');
      const session = await this.supabase.getSession();
      console.log('[AuthService] 📦 Initial session result:', { hasSession: !!session, hasUser: !!session?.user });

      if (session?.user) {
        console.log(`[AuthService] 👤 User found: ${session.user.email}, fetching profile...`);
        const profile = await this.fetchProfile(session.user.id, session.user.email);
        console.log('[AuthService] 📋 Profile result:', { hasProfile: !!profile, displayName: profile?.displayName });

        this.authState.set({
          user: profile,
          isAuthenticated: !!profile,
          isLoading: false
        });
        console.log('[AuthService] ✅ Auth initialized with user, isAuthenticated:', !!profile);
      } else {
        console.log('[AuthService] 👻 No initial session found');
        this.authState.set({
          user: null,
          isAuthenticated: false,
          isLoading: false
        });
        console.log('[AuthService] ✅ Auth initialized without user');
      }
    } catch (error) {
      console.error('[AuthService] ❌ CRITICAL ERROR in initializeAuth:', error);
      // ALWAYS set isLoading to false to prevent infinite loading
      this.authState.set({
        user: null,
        isAuthenticated: false,
        isLoading: false
      });
      console.log('[AuthService] 🔧 Recovered from error, isLoading set to false');
    }

    console.log('[AuthService] 🏁 initializeAuth() completed. Final state:', {
      isLoading: this.isLoading(),
      isAuthenticated: this.isAuthenticated(),
      hasUser: !!this.currentUser()
    });
  }

  private async fetchProfile(userId: string, email?: string): Promise<UserProfile | null> {
    console.log(`[AuthService] 🔍 fetchProfile() called for userId: ${userId}`);

    try {
      console.log('[AuthService] 📡 Querying profiles table...');

      // Add timeout to prevent infinite hanging
      const PROFILE_TIMEOUT_MS = 5000;
      const profilePromise = this.supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      const timeoutPromise = new Promise<{ data: null; error: { code: string; message: string } }>((resolve) => {
        setTimeout(() => {
          console.error('[AuthService] ⏰ Profile query TIMEOUT after 5 seconds!');
          resolve({ data: null, error: { code: 'TIMEOUT', message: 'Profile query timed out' } });
        }, PROFILE_TIMEOUT_MS);
      });

      const { data, error } = await Promise.race([profilePromise, timeoutPromise]);

      if (error) {
        console.log('[AuthService] ⚠️ Profile query error:', { code: error.code, message: error.message });

        // Profile doesn't exist OR timeout - try to create one
        if ((error.code === 'PGRST116' || error.code === 'TIMEOUT') && email) {
          console.log('[AuthService] 📝 Profile not found or timeout, creating new profile...');
          return await this.createProfile(userId, email);
        }
        throw error;
      }

      console.log('[AuthService] ✅ Profile found:', { id: data.id, email: data.email, displayName: data.display_name });

      return {
        id: data.id,
        email: data.email,
        displayName: data.display_name,
        avatarUrl: data.avatar_url,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at)
      };
    } catch (error: any) {
      console.error('[AuthService] ❌ Error fetching profile:', {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint
      });
      // Return a minimal profile from auth data so user can still access the app
      if (email) {
        console.log('[AuthService] 🔧 Creating fallback profile from auth data');
        return {
          id: userId,
          email: email,
          displayName: email.split('@')[0],
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }
      return null;
    }
  }

  private async createProfile(userId: string, email: string): Promise<UserProfile | null> {
    console.log(`[AuthService] 📝 createProfile() called for: ${email}`);
    const displayName = email.split('@')[0];

    try {
      const now = new Date();
      console.log('[AuthService] 📡 Inserting new profile...');

      // Add timeout to prevent infinite hanging
      const CREATE_TIMEOUT_MS = 5000;
      const createPromise = this.supabase
        .from('profiles')
        .insert({
          id: userId,
          email: email,
          display_name: displayName,
          created_at: now.toISOString(),
          updated_at: now.toISOString()
        })
        .select()
        .single();

      const timeoutPromise = new Promise<{ data: null; error: { code: string; message: string } }>((resolve) => {
        setTimeout(() => {
          console.error('[AuthService] ⏰ Create profile TIMEOUT after 5 seconds!');
          resolve({ data: null, error: { code: 'TIMEOUT', message: 'Create profile timed out' } });
        }, CREATE_TIMEOUT_MS);
      });

      const { data, error } = await Promise.race([createPromise, timeoutPromise]);

      if (error) {
        console.error('[AuthService] ❌ Error inserting profile:', { code: error.code, message: error.message });
        throw error;
      }

      console.log('[AuthService] ✅ Profile created successfully:', { id: data.id, displayName: data.display_name });

      return {
        id: data.id,
        email: data.email,
        displayName: data.display_name,
        avatarUrl: data.avatar_url,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at)
      };
    } catch (error: any) {
      console.error('[AuthService] ❌ Error creating profile:', {
        message: error?.message,
        code: error?.code,
        details: error?.details
      });
      // Return fallback profile so user can access the app
      console.log('[AuthService] 🔧 Returning fallback profile');
      return {
        id: userId,
        email: email,
        displayName: displayName,
        createdAt: new Date(),
        updatedAt: new Date()
      };
    }
  }

  // ==================== AUTH METHODS ====================

  async signUp(email: string, password: string, displayName?: string): Promise<{ success: boolean; error?: string; needsEmailConfirmation?: boolean }> {
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

      // Check if we have a session (user is immediately logged in)
      const session = await this.supabase.getSession();

      if (session?.user) {
        // User is logged in immediately (email confirmation disabled)
        // First, ensure profile exists
        let profile = await this.fetchProfile(session.user.id, session.user.email || email);

        // Update displayName if provided
        if (profile && displayName) {
          await this.supabase
            .from('profiles')
            .update({ display_name: displayName })
            .eq('id', session.user.id);
          profile.displayName = displayName;
        }

        // Create default workspace
        await this.createDefaultWorkspace(session.user.id);

        // Update auth state
        this.authState.set({
          user: profile,
          isAuthenticated: !!profile,
          isLoading: false
        });

        return { success: true };
      } else {
        // Email confirmation is required
        this.authState.update(state => ({ ...state, isLoading: false }));
        return { success: true, needsEmailConfirmation: true };
      }
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

      // Update auth state immediately after successful login
      if (user) {
        const profile = await this.fetchProfile(user.id, user.email || email);
        this.authState.set({
          user: profile,
          isAuthenticated: !!profile,
          isLoading: false
        });

        if (!profile) {
          return { success: false, error: 'Error al cargar el perfil del usuario' };
        }
      }

      return { success: true };
    } catch (error: any) {
      this.authState.update(state => ({ ...state, isLoading: false }));
      return { success: false, error: error.message };
    }
  }

  async signOut(): Promise<void> {
    // In offline mode, just clear auth state and redirect
    if (this.offlineMode()) {
      this.authState.set({
        user: null,
        isAuthenticated: false,
        isLoading: false
      });
      this.router.navigate(['/login']);
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
