import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';

@Component({
  selector: 'app-test',
  template: '<div>Angular Test</div>'
})
export class TestComponent implements OnInit {
  @Input() title: string = '';
  @Output() clicked = new EventEmitter<void>();

  constructor() {}

  ngOnInit() {
    console.log('Angular Init');
  }

  handleClick() {
    this.clicked.emit();
  }
}
