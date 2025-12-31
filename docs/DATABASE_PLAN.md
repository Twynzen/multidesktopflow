# MultiDesktopFlow - Plan de Base de Datos y Sincronización

> **Versión del Plan:** 1.0.0
> **Fecha:** 2024
> **Estado:** Planificación aprobada

---

## Tabla de Contenidos

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Arquitectura General](#2-arquitectura-general)
3. [Configuración de Supabase](#3-configuración-de-supabase)
4. [Esquema de Base de Datos](#4-esquema-de-base-de-datos)
5. [Sistema de Autenticación](#5-sistema-de-autenticación)
6. [Sistema de Mapas](#6-sistema-de-mapas)
7. [Sincronización y Versionado](#7-sincronización-y-versionado)
8. [Formato de Exportación](#8-formato-de-exportación)
9. [Plan de Implementación](#9-plan-de-implementación)
10. [API Reference](#10-api-reference)

---

## 1. Resumen Ejecutivo

### Objetivos
- Implementar autenticación básica (registro/login)
- Migrar de localStorage a IndexedDB (local) + Supabase (remoto)
- Sistema de "Mapas" para exportar/importar árboles de contenido completos
- Sincronización manual con botón "Guardar partida"
- Versionado e historial de cambios

### Decisiones Técnicas

| Componente | Tecnología | Justificación |
|------------|------------|---------------|
| DB Local | IndexedDB (Dexie.js) | Sin límite de tamaño, offline-first |
| DB Remota | Supabase (PostgreSQL) | Gratuito, realtime, auth integrado |
| Storage Archivos | Supabase Storage | Imágenes como archivos, no Base64 |
| Auth | Supabase Auth | Email/password, JWT integrado |
| Sync | Manual con botón | "Guardar partida" explícito |

---

## 2. Arquitectura General

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USUARIO                                     │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    ANGULAR APPLICATION                               │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                      COMPONENTES UI                              │ │
│  │  • LoginComponent    • RegisterComponent   • ToolbarComponent   │ │
│  │  • DesktopComponent  • NoteComponent       • FolderComponent    │ │
│  │  • SyncIndicator     • VersionHistory      • MapExporter        │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                │                                     │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                       SERVICIOS                                  │ │
│  │  • AuthService       • StorageService      • SyncService        │ │
│  │  • MapService        • VersionService      • SupabaseService    │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                │
            ┌───────────────────┴───────────────────┐
            ▼                                       ▼
┌───────────────────────┐               ┌───────────────────────────┐
│     IndexedDB         │               │        SUPABASE           │
│      (LOCAL)          │               │        (REMOTO)           │
│                       │   ──Sync──►   │                           │
│  • Desktops           │   (Manual)    │  • PostgreSQL (datos)     │
│  • Notes              │               │  • Storage (imágenes)     │
│  • Folders            │   ◄──Pull──   │  • Auth (usuarios)        │
│  • Assets (blobs)     │               │  • Versions (historial)   │
│  • PendingChanges     │               │                           │
└───────────────────────┘               └───────────────────────────┘
```

### Flujo de Datos

```
1. Usuario edita contenido
         │
         ▼
2. Cambio se guarda INMEDIATAMENTE en IndexedDB (tiempo real local)
         │
         ▼
3. Cambio se registra en cola "pendingChanges"
         │
         ▼
4. Usuario hace clic en [💾 Guardar Partida]
         │
         ▼
5. SyncService:
   a. Empaqueta todos los cambios pendientes
   b. Crea nuevo registro de versión
   c. Sube a Supabase
   d. Limpia cola de pendientes
   e. Muestra confirmación
```

---

## 3. Configuración de Supabase

### Paso 1: Crear Proyecto en Supabase

1. Ir a [https://supabase.com](https://supabase.com)
2. Crear cuenta o iniciar sesión
3. Click en "New Project"
4. Configurar:
   - **Name:** `multidesktopflow`
   - **Database Password:** (guardar en lugar seguro)
   - **Region:** Elegir la más cercana
5. Esperar a que se cree el proyecto (~2 minutos)

### Paso 2: Obtener Credenciales

En el dashboard de Supabase, ir a **Settings > API**:

```
SUPABASE_URL = https://xxxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Paso 3: Crear archivo de configuración

Crear archivo `src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  supabase: {
    url: 'https://TU_PROJECT_ID.supabase.co',
    anonKey: 'TU_ANON_KEY'
  }
};
```

Crear archivo `src/environments/environment.prod.ts`:

```typescript
export const environment = {
  production: true,
  supabase: {
    url: 'https://TU_PROJECT_ID.supabase.co',
    anonKey: 'TU_ANON_KEY'
  }
};
```

### Paso 4: Ejecutar SQL en Supabase

Ir a **SQL Editor** en Supabase y ejecutar el siguiente script:

```sql
-- ============================================
-- MULTIDESKTOPFLOW DATABASE SCHEMA
-- ============================================

-- Habilitar extensión UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TABLA: profiles (extensión de auth.users)
-- ============================================
CREATE TABLE public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Trigger para crear perfil automáticamente al registrarse
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, display_name)
    VALUES (NEW.id, NEW.email, SPLIT_PART(NEW.email, '@', 1));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- TABLA: workspaces (contenedor principal)
-- ============================================
CREATE TABLE public.workspaces (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL DEFAULT 'Mi Workspace',
    description TEXT,
    is_default BOOLEAN DEFAULT FALSE,
    theme_config JSONB DEFAULT '{"primaryColor": "#0d7337", "glowIntensity": 0.7, "particlesEnabled": true, "animationsEnabled": true}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE -- Soft delete
);

-- ============================================
-- TABLA: desktops
-- ============================================
CREATE TABLE public.desktops (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
    parent_id UUID REFERENCES public.desktops(id) ON DELETE CASCADE, -- NULL = root
    name TEXT NOT NULL DEFAULT 'Nuevo Escritorio',
    position_order INTEGER DEFAULT 0,
    local_id TEXT, -- ID original del cliente para mapeo
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- TABLA: notes
-- ============================================
CREATE TABLE public.notes (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    desktop_id UUID REFERENCES public.desktops(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL DEFAULT 'Nueva Nota',
    content TEXT DEFAULT '',
    position_x REAL DEFAULT 100,
    position_y REAL DEFAULT 100,
    width REAL DEFAULT 300,
    height REAL DEFAULT 200,
    color TEXT,
    z_index INTEGER DEFAULT 1,
    minimized BOOLEAN DEFAULT FALSE,
    local_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- TABLA: assets (imágenes y archivos)
-- ============================================
CREATE TABLE public.assets (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    note_id UUID REFERENCES public.notes(id) ON DELETE CASCADE NOT NULL,
    storage_path TEXT NOT NULL, -- Ruta en Supabase Storage
    original_name TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    width REAL,
    height REAL,
    position_x REAL DEFAULT 0,
    position_y REAL DEFAULT 0,
    local_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- TABLA: folders (enlaces entre desktops)
-- ============================================
CREATE TABLE public.folders (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    desktop_id UUID REFERENCES public.desktops(id) ON DELETE CASCADE NOT NULL,
    target_desktop_id UUID REFERENCES public.desktops(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    icon TEXT,
    color TEXT,
    position_x REAL DEFAULT 100,
    position_y REAL DEFAULT 100,
    local_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- TABLA: connections (líneas entre notas)
-- ============================================
CREATE TABLE public.connections (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    desktop_id UUID REFERENCES public.desktops(id) ON DELETE CASCADE NOT NULL,
    from_note_id UUID REFERENCES public.notes(id) ON DELETE CASCADE NOT NULL,
    to_note_id UUID REFERENCES public.notes(id) ON DELETE CASCADE NOT NULL,
    color TEXT,
    label TEXT,
    local_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- TABLA: versions (historial de cambios)
-- ============================================
CREATE TABLE public.versions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
    version_number INTEGER NOT NULL,
    snapshot JSONB NOT NULL, -- Estado completo del workspace
    change_summary TEXT, -- Descripción del cambio
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(workspace_id, version_number)
);

-- ============================================
-- TABLA: shared_maps (mapas compartidos)
-- ============================================
CREATE TABLE public.shared_maps (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    owner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    map_data JSONB NOT NULL, -- Contenido del mapa exportado
    is_public BOOLEAN DEFAULT FALSE,
    share_token TEXT UNIQUE, -- Token para compartir privadamente
    download_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- ÍNDICES PARA RENDIMIENTO
-- ============================================
CREATE INDEX idx_workspaces_user ON public.workspaces(user_id);
CREATE INDEX idx_desktops_workspace ON public.desktops(workspace_id);
CREATE INDEX idx_desktops_parent ON public.desktops(parent_id);
CREATE INDEX idx_notes_desktop ON public.notes(desktop_id);
CREATE INDEX idx_assets_note ON public.assets(note_id);
CREATE INDEX idx_folders_desktop ON public.folders(desktop_id);
CREATE INDEX idx_connections_desktop ON public.connections(desktop_id);
CREATE INDEX idx_versions_workspace ON public.versions(workspace_id);
CREATE INDEX idx_shared_maps_owner ON public.shared_maps(owner_id);
CREATE INDEX idx_shared_maps_token ON public.shared_maps(share_token);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Habilitar RLS en todas las tablas
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desktops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_maps ENABLE ROW LEVEL SECURITY;

-- Políticas para profiles
CREATE POLICY "Users can view own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

-- Políticas para workspaces
CREATE POLICY "Users can view own workspaces" ON public.workspaces
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create workspaces" ON public.workspaces
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own workspaces" ON public.workspaces
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own workspaces" ON public.workspaces
    FOR DELETE USING (auth.uid() = user_id);

-- Políticas para desktops (a través de workspace)
CREATE POLICY "Users can manage desktops in own workspaces" ON public.desktops
    FOR ALL USING (
        workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())
    );

-- Políticas para notes (a través de desktop -> workspace)
CREATE POLICY "Users can manage notes in own workspaces" ON public.notes
    FOR ALL USING (
        desktop_id IN (
            SELECT d.id FROM public.desktops d
            JOIN public.workspaces w ON d.workspace_id = w.id
            WHERE w.user_id = auth.uid()
        )
    );

-- Políticas para assets
CREATE POLICY "Users can manage assets in own workspaces" ON public.assets
    FOR ALL USING (
        note_id IN (
            SELECT n.id FROM public.notes n
            JOIN public.desktops d ON n.desktop_id = d.id
            JOIN public.workspaces w ON d.workspace_id = w.id
            WHERE w.user_id = auth.uid()
        )
    );

-- Políticas para folders
CREATE POLICY "Users can manage folders in own workspaces" ON public.folders
    FOR ALL USING (
        desktop_id IN (
            SELECT d.id FROM public.desktops d
            JOIN public.workspaces w ON d.workspace_id = w.id
            WHERE w.user_id = auth.uid()
        )
    );

-- Políticas para connections
CREATE POLICY "Users can manage connections in own workspaces" ON public.connections
    FOR ALL USING (
        desktop_id IN (
            SELECT d.id FROM public.desktops d
            JOIN public.workspaces w ON d.workspace_id = w.id
            WHERE w.user_id = auth.uid()
        )
    );

-- Políticas para versions
CREATE POLICY "Users can manage versions in own workspaces" ON public.versions
    FOR ALL USING (
        workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())
    );

-- Políticas para shared_maps
CREATE POLICY "Users can view own shared maps" ON public.shared_maps
    FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "Users can view public shared maps" ON public.shared_maps
    FOR SELECT USING (is_public = true);
CREATE POLICY "Users can create shared maps" ON public.shared_maps
    FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Users can update own shared maps" ON public.shared_maps
    FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Users can delete own shared maps" ON public.shared_maps
    FOR DELETE USING (auth.uid() = owner_id);

-- ============================================
-- STORAGE BUCKET PARA IMÁGENES
-- ============================================
-- Ejecutar en SQL Editor:
INSERT INTO storage.buckets (id, name, public)
VALUES ('assets', 'assets', true);

-- Política para subir archivos
CREATE POLICY "Users can upload assets"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'assets' AND
    auth.uid() IS NOT NULL
);

-- Política para ver archivos propios
CREATE POLICY "Users can view own assets"
ON storage.objects FOR SELECT
USING (
    bucket_id = 'assets' AND
    auth.uid() IS NOT NULL
);

-- Política para eliminar archivos propios
CREATE POLICY "Users can delete own assets"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'assets' AND
    auth.uid() IS NOT NULL
);
```

### Paso 5: Habilitar Autenticación Email

1. En Supabase Dashboard, ir a **Authentication > Providers**
2. Verificar que "Email" esté habilitado
3. Opcional: Deshabilitar "Confirm email" para desarrollo rápido
   - Authentication > Settings > "Enable email confirmations" = OFF

### Paso 6: Verificar Configuración

Ejecutar esta query para verificar que todo esté creado:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

Debe mostrar:
- assets
- connections
- desktops
- folders
- notes
- profiles
- shared_maps
- versions
- workspaces

---

## 4. Esquema de Base de Datos

### Diagrama de Relaciones

```
┌─────────────────┐
│    profiles     │
│  (auth.users)   │
└────────┬────────┘
         │ 1:N
         ▼
┌─────────────────┐       ┌─────────────────┐
│   workspaces    │──────►│    versions     │
│                 │  1:N  │  (historial)    │
└────────┬────────┘       └─────────────────┘
         │ 1:N
         ▼
┌─────────────────┐
│    desktops     │◄──────┐
│                 │       │ parent_id (self-ref)
└────────┬────────┘───────┘
         │ 1:N
         ├──────────────────┬──────────────────┐
         ▼                  ▼                  ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│     notes       │  │    folders      │  │  connections    │
│                 │  │                 │  │                 │
└────────┬────────┘  └─────────────────┘  └─────────────────┘
         │ 1:N
         ▼
┌─────────────────┐
│     assets      │
│   (imágenes)    │
└─────────────────┘
```

### Descripción de Tablas

| Tabla | Propósito |
|-------|-----------|
| `profiles` | Datos de usuario (extensión de auth.users) |
| `workspaces` | Contenedor principal, un usuario puede tener varios |
| `desktops` | Escritorios, pueden anidarse vía parent_id |
| `notes` | Notas con texto y posición |
| `assets` | Imágenes almacenadas en Supabase Storage |
| `folders` | Enlaces visuales entre desktops |
| `connections` | Líneas que conectan notas |
| `versions` | Snapshots del workspace para historial |
| `shared_maps` | Mapas exportados para compartir |

---

## 5. Sistema de Autenticación

### Componentes a Crear

```
src/app/
├── components/
│   ├── auth/
│   │   ├── login/
│   │   │   ├── login.component.ts
│   │   │   ├── login.component.html
│   │   │   └── login.component.scss
│   │   ├── register/
│   │   │   ├── register.component.ts
│   │   │   ├── register.component.html
│   │   │   └── register.component.scss
│   │   └── auth-guard.ts
├── services/
│   ├── auth.service.ts
│   └── supabase.service.ts
```

### AuthService API

```typescript
interface AuthService {
  // Estado
  currentUser: Signal<User | null>;
  isAuthenticated: Signal<boolean>;
  isLoading: Signal<boolean>;

  // Métodos
  signUp(email: string, password: string): Promise<AuthResult>;
  signIn(email: string, password: string): Promise<AuthResult>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<void>;

  // Perfil
  getProfile(): Promise<Profile>;
  updateProfile(updates: Partial<Profile>): Promise<Profile>;
}
```

### Flujo de Autenticación

```
┌──────────────────────────────────────────────────────────────┐
│                    FLUJO DE LOGIN                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Usuario no autenticado                                   │
│         │                                                    │
│         ▼                                                    │
│  2. Mostrar LoginComponent                                   │
│         │                                                    │
│         ├──► [Iniciar Sesión] ──► Supabase Auth             │
│         │         │                                          │
│         │         ▼                                          │
│         │    Validar credenciales                            │
│         │         │                                          │
│         │         ├──► ✓ Éxito ──► Cargar workspace         │
│         │         │                     │                    │
│         │         │                     ▼                    │
│         │         │              Mostrar Desktop             │
│         │         │                                          │
│         │         └──► ✗ Error ──► Mostrar mensaje          │
│         │                                                    │
│         └──► [Registrarse] ──► RegisterComponent            │
│                   │                                          │
│                   ▼                                          │
│              Crear cuenta                                    │
│                   │                                          │
│                   ▼                                          │
│              Crear workspace por defecto                     │
│                   │                                          │
│                   ▼                                          │
│              Mostrar Desktop                                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. Sistema de Mapas

### Definición de Mapa

Un **MAPA** es un árbol completo de contenido que incluye:

```
📦 MAPA
│
├── Desktop raíz (punto de entrada)
│   ├── Notas (con su contenido e imágenes)
│   ├── Conexiones entre notas
│   └── Carpetas (enlaces a sub-desktops)
│
└── Todos los sub-desktops recursivamente
    ├── Sus notas
    ├── Sus conexiones
    ├── Sus carpetas
    └── Sus sub-desktops (y así infinitamente)
```

### Ejemplo Visual

```
📦 MAPA: "Proyecto Arroz"
│
├── 📝 "Ingredientes principales"
├── 📝 "Pasos de preparación"
├── 📝 "Tips del chef"
├── 🖼️ foto_arroz.jpg
├── ═══ Conexión: Ingredientes → Pasos
│
└── 📁 "Historia del Arroz" ──────────────────┐
                                               │
    ┌──────────────────────────────────────────┘
    │
    ├── 📝 "Origen asiático"
    ├── 📝 "Llegada a América"
    ├── 🖼️ mapa_historico.png
    │
    └── 📁 "Variedades" ──────────────────────┐
                                               │
        ┌──────────────────────────────────────┘
        │
        ├── 📝 "Arroz Basmati"
        ├── 📝 "Arroz Integral"
        └── 🖼️ tipos_arroz.jpg

═══════════════════════════════════════════════
Al exportar "Proyecto Arroz" como MAPA:
- Se incluye TODO lo anterior
- Se genera archivo .mdflow
- Al importar: se crea COPIA INDEPENDIENTE
═══════════════════════════════════════════════
```

### Operaciones de Mapas

| Operación | Descripción |
|-----------|-------------|
| **Exportar Mapa** | Seleccionar carpeta → Generar .mdflow con todo su árbol |
| **Importar Mapa** | Cargar .mdflow → Crear copia independiente en desktop actual |
| **Compartir Mapa** | Subir a shared_maps → Generar link/token |
| **Descargar Mapa Compartido** | Obtener por token → Importar como copia |

### Formato .mdflow

```typescript
interface MapFile {
  // Metadatos
  format: "mdflow";
  version: "1.0.0";

  metadata: {
    name: string;
    description?: string;
    author?: string;
    exportedAt: string;
    sourceApp: "MultiDesktopFlow";
    sourceVersion: string;
    checksum: string;
  };

  // Contenido
  content: {
    // Desktop raíz y todos sus descendientes
    desktops: MapDesktop[];

    // Imágenes embebidas (Base64 para portabilidad)
    assets: MapAsset[];
  };

  // Estructura del árbol
  structure: {
    rootDesktopLocalId: string;
    hierarchy: {
      [desktopLocalId: string]: {
        parentLocalId: string | null;
        childrenLocalIds: string[];
      };
    };
  };
}

interface MapDesktop {
  localId: string;  // ID temporal para referencias internas
  name: string;
  notes: MapNote[];
  folders: MapFolder[];
  connections: MapConnection[];
}

interface MapNote {
  localId: string;
  title: string;
  content: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  color?: string;
  zIndex: number;
  minimized: boolean;
  assetLocalIds: string[];  // Referencias a imágenes
}

interface MapAsset {
  localId: string;
  noteLocalId: string;
  data: string;  // Base64
  originalName?: string;
  mimeType: string;
  size: { width: number; height: number };
  position: { x: number; y: number };
}

interface MapFolder {
  localId: string;
  name: string;
  icon?: string;
  color?: string;
  position: { x: number; y: number };
  targetDesktopLocalId: string;
}

interface MapConnection {
  localId: string;
  fromNoteLocalId: string;
  toNoteLocalId: string;
  color?: string;
}
```

---

## 7. Sincronización y Versionado

### Estrategia de Sincronización

```
┌─────────────────────────────────────────────────────────────────┐
│                  FLUJO DE SINCRONIZACIÓN                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  TIEMPO REAL (Local)           MANUAL (Remoto)                  │
│  ═══════════════════           ════════════════                 │
│                                                                  │
│  Usuario edita                                                   │
│       │                                                          │
│       ▼                                                          │
│  IndexedDB ◄─────────────── Cambio inmediato                    │
│       │                                                          │
│       ▼                                                          │
│  pendingChanges[] ◄──────── Registrar cambio                    │
│       │                                                          │
│       │ (acumulando cambios...)                                  │
│       │                                                          │
│       ▼                                                          │
│  [💾 Guardar Partida] ◄───── Usuario decide cuándo              │
│       │                                                          │
│       ▼                                                          │
│  SyncService.saveToCloud()                                       │
│       │                                                          │
│       ├──► 1. Crear snapshot del estado actual                  │
│       │                                                          │
│       ├──► 2. Incrementar version_number                        │
│       │                                                          │
│       ├──► 3. Subir a Supabase (workspaces, desktops, etc)     │
│       │                                                          │
│       ├──► 4. Subir imágenes nuevas a Storage                   │
│       │                                                          │
│       ├──► 5. Guardar en tabla versions                          │
│       │                                                          │
│       └──► 6. Limpiar pendingChanges[]                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Sistema de Versionado

```typescript
interface Version {
  id: string;
  workspaceId: string;
  versionNumber: number;        // Auto-incrementa
  snapshot: AppState;           // Estado completo
  changeSummary: string;        // "3 notas, 1 carpeta, 2 imágenes"
  createdAt: Date;
}

// Operaciones
interface VersionService {
  // Guardar nueva versión
  saveVersion(changeSummary?: string): Promise<Version>;

  // Listar historial
  getVersionHistory(limit?: number): Promise<Version[]>;

  // Restaurar versión anterior
  restoreVersion(versionId: string): Promise<void>;

  // Comparar versiones
  compareVersions(v1: string, v2: string): Promise<VersionDiff>;
}
```

### Indicadores de Estado en UI

```
┌─────────────────────────────────────────────────────────────┐
│  [TOOLBAR]                                                   │
│                                                              │
│  ... otros botones ...   │  Estado: ● Sin cambios           │
│                          │          ○ 5 cambios pendientes  │
│                          │          ◐ Sincronizando...      │
│                          │          ✓ Guardado (v15)        │
│                          │          ✗ Error de conexión     │
│                                                              │
│  [💾 Guardar Partida]  [📜 Historial]                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. Formato de Exportación

### Archivo .mdflow

Extensión: `.mdflow`
MIME Type: `application/json`
Encoding: `UTF-8`

### Estructura del Archivo

```json
{
  "format": "mdflow",
  "version": "1.0.0",
  "metadata": {
    "name": "Proyecto Arroz",
    "description": "Receta completa con historia",
    "author": "usuario@email.com",
    "exportedAt": "2024-01-15T10:30:00Z",
    "sourceApp": "MultiDesktopFlow",
    "sourceVersion": "1.0.0",
    "checksum": "sha256:abc123..."
  },
  "content": {
    "desktops": [
      {
        "localId": "d1",
        "name": "Proyecto Arroz",
        "notes": [
          {
            "localId": "n1",
            "title": "Ingredientes",
            "content": "- 2 tazas de arroz\n- 4 tazas de agua",
            "position": { "x": 100, "y": 100 },
            "size": { "width": 300, "height": 200 },
            "zIndex": 1,
            "minimized": false,
            "assetLocalIds": []
          }
        ],
        "folders": [
          {
            "localId": "f1",
            "name": "Historia del Arroz",
            "position": { "x": 500, "y": 100 },
            "targetDesktopLocalId": "d2"
          }
        ],
        "connections": []
      },
      {
        "localId": "d2",
        "name": "Historia del Arroz",
        "notes": [...],
        "folders": [...],
        "connections": [...]
      }
    ],
    "assets": [
      {
        "localId": "a1",
        "noteLocalId": "n2",
        "data": "data:image/png;base64,iVBORw0KGgo...",
        "originalName": "foto_arroz.png",
        "mimeType": "image/png",
        "size": { "width": 400, "height": 300 },
        "position": { "x": 10, "y": 50 }
      }
    ]
  },
  "structure": {
    "rootDesktopLocalId": "d1",
    "hierarchy": {
      "d1": { "parentLocalId": null, "childrenLocalIds": ["d2"] },
      "d2": { "parentLocalId": "d1", "childrenLocalIds": [] }
    }
  }
}
```

---

## 9. Plan de Implementación

### Fase 1: Infraestructura Base (Fundamentos)
- [ ] Instalar dependencias (Dexie.js, @supabase/supabase-js)
- [ ] Crear SupabaseService con cliente configurado
- [ ] Crear archivo de environments
- [ ] Configurar IndexedDB con Dexie.js
- [ ] Crear modelos/interfaces actualizados

### Fase 2: Autenticación
- [ ] Crear AuthService
- [ ] Crear LoginComponent
- [ ] Crear RegisterComponent
- [ ] Crear AuthGuard
- [ ] Integrar rutas protegidas
- [ ] Crear workspace por defecto al registrar

### Fase 3: Migración de Storage
- [ ] Migrar StorageService a usar IndexedDB
- [ ] Separar imágenes (Blob storage)
- [ ] Implementar cola de cambios pendientes
- [ ] Mantener compatibilidad con localStorage existente

### Fase 4: Sincronización
- [ ] Crear SyncService
- [ ] Implementar "Guardar Partida" (push to cloud)
- [ ] Implementar "Cargar Partida" (pull from cloud)
- [ ] Subir imágenes a Supabase Storage
- [ ] Indicadores de estado en UI

### Fase 5: Versionado
- [ ] Crear VersionService
- [ ] Implementar guardado de snapshots
- [ ] Crear panel de historial
- [ ] Implementar restauración de versión

### Fase 6: Sistema de Mapas
- [ ] Crear MapService
- [ ] Implementar exportación de mapa (generar .mdflow)
- [ ] Implementar importación de mapa (copia independiente)
- [ ] UI: botón "Guardar como Mapa" en carpetas
- [ ] UI: botón "Insertar Mapa" en toolbar

### Fase 7: Compartir Mapas
- [ ] Implementar subida a shared_maps
- [ ] Generar tokens de compartir
- [ ] UI para explorar mapas públicos
- [ ] Descargar mapas compartidos

### Fase 8: UI/UX Final
- [ ] Nuevos botones en toolbar
- [ ] Indicadores de sync
- [ ] Modal de historial de versiones
- [ ] Notificaciones de estado
- [ ] Mejoras de feedback visual

---

## 10. API Reference

### SupabaseService

```typescript
class SupabaseService {
  client: SupabaseClient;

  // Auth
  signUp(email: string, password: string): Promise<AuthResponse>;
  signIn(email: string, password: string): Promise<AuthResponse>;
  signOut(): Promise<void>;
  getSession(): Promise<Session | null>;

  // Database
  from(table: string): PostgrestQueryBuilder;

  // Storage
  uploadFile(bucket: string, path: string, file: Blob): Promise<string>;
  getFileUrl(bucket: string, path: string): string;
  deleteFile(bucket: string, path: string): Promise<void>;
}
```

### SyncService

```typescript
class SyncService {
  // Estado
  syncStatus: Signal<'idle' | 'pending' | 'syncing' | 'error'>;
  pendingChangesCount: Signal<number>;
  lastSyncedVersion: Signal<number>;

  // Operaciones
  saveToCloud(): Promise<SyncResult>;
  loadFromCloud(): Promise<void>;
  getConflicts(): Promise<Conflict[]>;
  resolveConflict(conflictId: string, resolution: 'local' | 'remote'): Promise<void>;
}
```

### MapService

```typescript
class MapService {
  // Exportar
  exportDesktopAsMap(desktopId: string): Promise<MapFile>;
  downloadMap(desktopId: string): Promise<void>;  // Descarga .mdflow

  // Importar
  importMap(file: File): Promise<ImportResult>;
  importMapToDesktop(mapData: MapFile, targetDesktopId: string): Promise<void>;

  // Compartir
  shareMap(desktopId: string, isPublic: boolean): Promise<ShareResult>;
  getSharedMap(token: string): Promise<MapFile>;
  listPublicMaps(): Promise<SharedMapInfo[]>;
}
```

### VersionService

```typescript
class VersionService {
  // Historial
  currentVersion: Signal<number>;

  // Operaciones
  saveVersion(summary?: string): Promise<Version>;
  getHistory(limit?: number): Promise<Version[]>;
  getVersion(versionId: string): Promise<Version>;
  restoreVersion(versionId: string): Promise<void>;

  // Comparación
  compareWithCurrent(versionId: string): Promise<VersionDiff>;
}
```

---

## Notas Adicionales

### Seguridad
- Todas las tablas usan Row Level Security (RLS)
- Los usuarios solo pueden acceder a sus propios datos
- Los tokens de compartir son únicos y seguros

### Rendimiento
- IndexedDB para operaciones locales rápidas
- Sync manual para evitar overhead de red
- Imágenes en Storage separado (no Base64 en DB)

### Escalabilidad
- Estructura normalizada permite crecimiento
- Índices en campos frecuentemente consultados
- Soft delete para recuperación de datos

---

**Documento generado para MultiDesktopFlow**
**Próximo paso: Implementación Fase 1**
