// The pop-out pasture window's grip: a slim strip in a window_drag block (layouts written by
// `drover dashboard --window`). Dragging it moves the window; a double-click maximizes it.
import { View, div } from "gpui-kit";
import { theme } from "herdr";

export default class Titlebar extends View {
  render() {
    const t = theme();
    return div().id("root").size_full().flex().items_center().justify_center().bg(t.canvas)
      .tooltip("Drag to move · double-click to maximize")
      .child(div().w(44).h(4).rounded(2).bg(t.border));
  }
}
