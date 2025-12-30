import { Component } from '@angular/core';
import { DesktopComponent } from './components/desktop/desktop.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DesktopComponent],
  template: '<app-desktop></app-desktop>',
  styles: [`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
  `]
})
export class App {}
