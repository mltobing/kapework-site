/* seed-bank.js — Proof Grid 6×6: loads and exposes the offline seed bank */

"use strict";

var PG36SeedBank = (function () {

  /*
   * Seeds are inlined here (copied from data/seed-bank-6x6.json) so the app
   * works without an extra fetch.  The JSON file is the authoritative source;
   * this module is generated from it.
   *
   * Symbol encoding for all seeds:
   *   0 = hollow circle   (shape=circle,  fill=hollow)
   *   1 = filled circle   (shape=circle,  fill=filled)
   *   2 = hollow square   (shape=square,  fill=hollow)
   *   3 = filled square   (shape=square,  fill=filled)
   *   4 = hollow triangle (shape=triangle,fill=hollow)
   *   5 = filled triangle (shape=triangle,fill=filled)
   *
   *   shapeIndex = Math.floor(v / 2)   → 0=circle, 1=square, 2=triangle
   *   fillIndex  = v % 2               → 0=hollow, 1=filled
   *
   * Isotopy coverage:
   *   Seeds 0,1,4,6,7 — abelian group class  (Z3×Z2 ≅ Z6)
   *   Seeds 2,3,5     — non-abelian group class  (S3 / D3)
   *
   * TODO: Vendor additional seeds from McKay's reduced-Latin-square database
   * (https://users.cecs.anu.edu.au/~bdm/data/latin.html) to cover more of the
   * 12 known isotopy classes of order-6 Latin squares.  The current bank
   * covers 2 isotopy classes (abelian and non-abelian group structures).
   */

  var seeds = [
    {
      id: "z3xz2-algebraic",
      isotopyClass: "abelian-group-z3xz2",
      grid: [
        [0,1,2,3,4,5],
        [1,0,3,2,5,4],
        [2,3,4,5,0,1],
        [3,2,5,4,1,0],
        [4,5,0,1,2,3],
        [5,4,1,0,3,2]
      ]
    },
    {
      id: "z6-cyclic",
      isotopyClass: "abelian-group-z6",
      grid: [
        [0,1,2,3,4,5],
        [1,2,3,4,5,0],
        [2,3,4,5,0,1],
        [3,4,5,0,1,2],
        [4,5,0,1,2,3],
        [5,0,1,2,3,4]
      ]
    },
    {
      id: "s3-dihedral",
      isotopyClass: "non-abelian-group-s3",
      grid: [
        [0,1,2,3,4,5],
        [1,2,0,5,3,4],
        [2,0,1,4,5,3],
        [3,4,5,0,2,1],
        [4,5,3,1,0,2],
        [5,3,4,2,1,0]
      ]
    },
    {
      id: "s3-relabeled",
      isotopyClass: "non-abelian-group-s3",
      grid: [
        [0,3,1,4,2,5],
        [3,1,0,5,4,2],
        [1,0,3,2,5,4],
        [4,2,5,0,1,3],
        [2,5,4,3,0,1],
        [5,4,2,1,3,0]
      ]
    },
    {
      id: "z3xz2-rowperm",
      isotopyClass: "abelian-group-z3xz2",
      grid: [
        [2,3,4,5,0,1],
        [0,1,2,3,4,5],
        [4,5,0,1,2,3],
        [1,0,3,2,5,4],
        [5,4,1,0,3,2],
        [3,2,5,4,1,0]
      ]
    },
    {
      id: "s3-rowperm",
      isotopyClass: "non-abelian-group-s3",
      grid: [
        [3,4,5,0,2,1],
        [1,2,0,5,3,4],
        [4,5,3,1,0,2],
        [0,1,2,3,4,5],
        [5,3,4,2,1,0],
        [2,0,1,4,5,3]
      ]
    },
    {
      id: "z3xz2-colperm",
      isotopyClass: "abelian-group-z3xz2",
      grid: [
        [3,1,5,0,4,2],
        [2,0,4,1,5,3],
        [5,3,1,2,0,4],
        [4,2,0,3,1,5],
        [1,5,3,4,2,0],
        [0,4,2,5,3,1]
      ]
    },
    {
      id: "back-circulant",
      isotopyClass: "abelian-group-z6",
      grid: [
        [0,1,2,3,4,5],
        [5,0,1,2,3,4],
        [4,5,0,1,2,3],
        [3,4,5,0,1,2],
        [2,3,4,5,0,1],
        [1,2,3,4,5,0]
      ]
    }
  ];

  return { seeds: seeds };

})();
