// Tests de la lógica pura de celebraciones (hitos y frases).
import { describe, it, expect, vi } from "vitest";

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

import { crossedMilestone, saleCheer } from "./celebrate";

describe("crossedMilestone", () => {
  it("detecta el hito cruzado", () => {
    expect(crossedMilestone(20, 30)?.pct).toBe(25);
    expect(crossedMilestone(49, 50)?.pct).toBe(50);
    expect(crossedMilestone(89, 95)?.pct).toBe(90);
  });

  it("si se cruzan varios de golpe, devuelve el mayor", () => {
    expect(crossedMilestone(10, 80)?.pct).toBe(75);
    expect(crossedMilestone(0, 100)?.pct).toBe(100);
  });

  it("sin cruce no hay hito", () => {
    expect(crossedMilestone(30, 40)).toBeNull();
    expect(crossedMilestone(50, 50)).toBeNull(); // ya estaba en el hito
    expect(crossedMilestone(60, 55)).toBeNull(); // retroceso (venta anulada)
  });
});

describe("saleCheer", () => {
  it("devuelve una frase no vacía", () => {
    for (let i = 0; i < 20; i++) {
      expect(saleCheer().length).toBeGreaterThan(0);
    }
  });
});
