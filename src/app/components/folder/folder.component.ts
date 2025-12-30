import {
  Component,
  Input,
  Output,
  EventEmitter,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Folder } from '../../models/desktop.model';

@Component({
  selector: 'app-folder',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './folder.component.html',
  styleUrl: './folder.component.scss'
})
export class FolderComponent {
  @Input() folder!: Folder;
  @Input() stats: { notes: number, folders: number, images: number } = { notes: 0, folders: 0, images: 0 };
  @Output() folderOpen = new EventEmitter<void>();
  @Output() folderChange = new EventEmitter<Partial<Folder>>();
  @Output() folderDelete = new EventEmitter<void>();

  isDragging = signal(false);
  isEditing = signal(false);
  showMenu = signal(false);

  private dragOffset = { x: 0, y: 0 };

  get folderStyle() {
    return {
      left: `${this.folder.position.x}px`,
      top: `${this.folder.position.y}px`
    };
  }

  // ==================== DRAG ====================
  onDragStart(event: MouseEvent): void {
    if (this.isEditing()) return;

    event.preventDefault();
    this.isDragging.set(true);

    this.dragOffset = {
      x: event.clientX - this.folder.position.x,
      y: event.clientY - this.folder.position.y
    };

    document.addEventListener('mousemove', this.onDragMove);
    document.addEventListener('mouseup', this.onDragEnd);
  }

  private onDragMove = (event: MouseEvent): void => {
    if (!this.isDragging()) return;

    const newX = Math.max(0, event.clientX - this.dragOffset.x);
    const newY = Math.max(0, event.clientY - this.dragOffset.y);

    this.folderChange.emit({
      position: { x: newX, y: newY }
    });
  };

  private onDragEnd = (): void => {
    this.isDragging.set(false);
    document.removeEventListener('mousemove', this.onDragMove);
    document.removeEventListener('mouseup', this.onDragEnd);
  };

  // ==================== ACCIONES ====================
  onDoubleClick(): void {
    if (!this.isEditing()) {
      this.folderOpen.emit();
    }
  }

  onRename(): void {
    this.showMenu.set(false);
    this.isEditing.set(true);
  }

  onNameBlur(event: FocusEvent): void {
    const value = (event.target as HTMLInputElement).value;
    this.isEditing.set(false);
    this.folderChange.emit({ name: value || 'Nueva Carpeta' });
  }

  onNameKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      (event.target as HTMLInputElement).blur();
    }
    if (event.key === 'Escape') {
      this.isEditing.set(false);
    }
  }

  onDelete(): void {
    this.showMenu.set(false);
    this.folderDelete.emit();
  }

  toggleMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.showMenu.update(v => !v);
  }

  onClickOutside(): void {
    this.showMenu.set(false);
  }
}
