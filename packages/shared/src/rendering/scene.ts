import { RenderNode } from './render-node'

export class Scene extends RenderNode {
  public override isPointInside(x: number, y: number): boolean {
    return true // non-blocking mouse type event
  }
}
