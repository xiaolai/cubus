var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb2, mod) => function __require2() {
  return mod || (0, cb2[__getOwnPropNames(cb2)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to2, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to2, key) && key !== except)
        __defProp(to2, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to2;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/cubejs/lib/cube.js
var require_cube = __commonJS({
  "node_modules/cubejs/lib/cube.js"(exports, module) {
    (function() {
      var B, BL, BR, Cube2, D, DB, DBL, DF, DFR, DL, DLF, DR, DRB, F, FL, FR, L, R, U2, UB, UBR, UF, UFL, UL, ULB, UR, URF, centerColor, centerFacelet, cornerColor, cornerFacelet, edgeColor, edgeFacelet;
      [U2, R, F, D, L, B] = [0, 1, 2, 3, 4, 5];
      [URF, UFL, ULB, UBR, DFR, DLF, DBL, DRB] = [0, 1, 2, 3, 4, 5, 6, 7];
      [UR, UF, UL, UB, DR, DF, DL, DB, FR, FL, BL, BR] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      [centerFacelet, cornerFacelet, edgeFacelet] = function() {
        var _B, _D, _F, _L, _R, _U;
        _U = function(x) {
          return x - 1;
        };
        _R = function(x) {
          return _U(9) + x;
        };
        _F = function(x) {
          return _R(9) + x;
        };
        _D = function(x) {
          return _F(9) + x;
        };
        _L = function(x) {
          return _D(9) + x;
        };
        _B = function(x) {
          return _L(9) + x;
        };
        return [
          // Centers
          [
            4,
            13,
            22,
            31,
            40,
            49
          ],
          // Corners
          [
            [
              _U(9),
              _R(1),
              _F(3)
            ],
            [
              _U(7),
              _F(1),
              _L(3)
            ],
            [
              _U(1),
              _L(1),
              _B(3)
            ],
            [
              _U(3),
              _B(1),
              _R(3)
            ],
            [
              _D(3),
              _F(9),
              _R(7)
            ],
            [
              _D(1),
              _L(9),
              _F(7)
            ],
            [
              _D(7),
              _B(9),
              _L(7)
            ],
            [
              _D(9),
              _R(9),
              _B(7)
            ]
          ],
          // Edges
          [
            [
              _U(6),
              _R(2)
            ],
            [
              _U(8),
              _F(2)
            ],
            [
              _U(4),
              _L(2)
            ],
            [
              _U(2),
              _B(2)
            ],
            [
              _D(6),
              _R(8)
            ],
            [
              _D(2),
              _F(8)
            ],
            [
              _D(4),
              _L(8)
            ],
            [
              _D(8),
              _B(8)
            ],
            [
              _F(6),
              _R(4)
            ],
            [
              _F(4),
              _L(6)
            ],
            [
              _B(6),
              _L(4)
            ],
            [
              _B(4),
              _R(6)
            ]
          ]
        ];
      }();
      centerColor = ["U", "R", "F", "D", "L", "B"];
      cornerColor = [["U", "R", "F"], ["U", "F", "L"], ["U", "L", "B"], ["U", "B", "R"], ["D", "F", "R"], ["D", "L", "F"], ["D", "B", "L"], ["D", "R", "B"]];
      edgeColor = [["U", "R"], ["U", "F"], ["U", "L"], ["U", "B"], ["D", "R"], ["D", "F"], ["D", "L"], ["D", "B"], ["F", "R"], ["F", "L"], ["B", "L"], ["B", "R"]];
      Cube2 = function() {
        var faceNames, faceNums, parseAlg;
        class Cube3 {
          constructor(other) {
            var x;
            if (other != null) {
              this.init(other);
            } else {
              this.identity();
            }
            this.newCenter = function() {
              var k5, results;
              results = [];
              for (x = k5 = 0; k5 <= 5; x = ++k5) {
                results.push(0);
              }
              return results;
            }();
            this.newCp = function() {
              var k5, results;
              results = [];
              for (x = k5 = 0; k5 <= 7; x = ++k5) {
                results.push(0);
              }
              return results;
            }();
            this.newEp = function() {
              var k5, results;
              results = [];
              for (x = k5 = 0; k5 <= 11; x = ++k5) {
                results.push(0);
              }
              return results;
            }();
            this.newCo = function() {
              var k5, results;
              results = [];
              for (x = k5 = 0; k5 <= 7; x = ++k5) {
                results.push(0);
              }
              return results;
            }();
            this.newEo = function() {
              var k5, results;
              results = [];
              for (x = k5 = 0; k5 <= 11; x = ++k5) {
                results.push(0);
              }
              return results;
            }();
          }
          init(state) {
            this.center = state.center.slice(0);
            this.co = state.co.slice(0);
            this.ep = state.ep.slice(0);
            this.cp = state.cp.slice(0);
            return this.eo = state.eo.slice(0);
          }
          identity() {
            var x;
            this.center = [0, 1, 2, 3, 4, 5];
            this.cp = [0, 1, 2, 3, 4, 5, 6, 7];
            this.co = function() {
              var k5, results;
              results = [];
              for (x = k5 = 0; k5 <= 7; x = ++k5) {
                results.push(0);
              }
              return results;
            }();
            this.ep = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
            return this.eo = function() {
              var k5, results;
              results = [];
              for (x = k5 = 0; k5 <= 11; x = ++k5) {
                results.push(0);
              }
              return results;
            }();
          }
          toJSON() {
            return {
              center: this.center,
              cp: this.cp,
              co: this.co,
              ep: this.ep,
              eo: this.eo
            };
          }
          asString() {
            var corner, edge, i, k5, l, m, n, o, ori, p4, result;
            result = [];
            for (i = k5 = 0; k5 <= 5; i = ++k5) {
              result[9 * i + 4] = centerColor[this.center[i]];
            }
            for (i = l = 0; l <= 7; i = ++l) {
              corner = this.cp[i];
              ori = this.co[i];
              for (n = m = 0; m <= 2; n = ++m) {
                result[cornerFacelet[i][(n + ori) % 3]] = cornerColor[corner][n];
              }
            }
            for (i = o = 0; o <= 11; i = ++o) {
              edge = this.ep[i];
              ori = this.eo[i];
              for (n = p4 = 0; p4 <= 1; n = ++p4) {
                result[edgeFacelet[i][(n + ori) % 2]] = edgeColor[edge][n];
              }
            }
            return result.join("");
          }
          static fromString(str) {
            var col1, col2, cube, i, j2, k5, l, m, o, ori, p4, q, r, ref;
            cube = new Cube3();
            for (i = k5 = 0; k5 <= 5; i = ++k5) {
              for (j2 = l = 0; l <= 5; j2 = ++l) {
                if (str[9 * i + 4] === centerColor[j2]) {
                  cube.center[i] = j2;
                }
              }
            }
            for (i = m = 0; m <= 7; i = ++m) {
              for (ori = o = 0; o <= 2; ori = ++o) {
                if ((ref = str[cornerFacelet[i][ori]]) === "U" || ref === "D") {
                  break;
                }
              }
              col1 = str[cornerFacelet[i][(ori + 1) % 3]];
              col2 = str[cornerFacelet[i][(ori + 2) % 3]];
              for (j2 = p4 = 0; p4 <= 7; j2 = ++p4) {
                if (col1 === cornerColor[j2][1] && col2 === cornerColor[j2][2]) {
                  cube.cp[i] = j2;
                  cube.co[i] = ori % 3;
                }
              }
            }
            for (i = q = 0; q <= 11; i = ++q) {
              for (j2 = r = 0; r <= 11; j2 = ++r) {
                if (str[edgeFacelet[i][0]] === edgeColor[j2][0] && str[edgeFacelet[i][1]] === edgeColor[j2][1]) {
                  cube.ep[i] = j2;
                  cube.eo[i] = 0;
                  break;
                }
                if (str[edgeFacelet[i][0]] === edgeColor[j2][1] && str[edgeFacelet[i][1]] === edgeColor[j2][0]) {
                  cube.ep[i] = j2;
                  cube.eo[i] = 1;
                  break;
                }
              }
            }
            return cube;
          }
          clone() {
            return new Cube3(this.toJSON());
          }
          // A class method returning a new random cube
          static random() {
            return new Cube3().randomize();
          }
          isSolved() {
            var c2, cent, clone, e4, k5, l, m;
            clone = this.clone();
            clone.move(clone.upright());
            for (cent = k5 = 0; k5 <= 5; cent = ++k5) {
              if (clone.center[cent] !== cent) {
                return false;
              }
            }
            for (c2 = l = 0; l <= 7; c2 = ++l) {
              if (clone.cp[c2] !== c2) {
                return false;
              }
              if (clone.co[c2] !== 0) {
                return false;
              }
            }
            for (e4 = m = 0; m <= 11; e4 = ++m) {
              if (clone.ep[e4] !== e4) {
                return false;
              }
              if (clone.eo[e4] !== 0) {
                return false;
              }
            }
            return true;
          }
          // Multiply this Cube with another Cube, restricted to centers.
          centerMultiply(other) {
            var from, k5, to2;
            for (to2 = k5 = 0; k5 <= 5; to2 = ++k5) {
              from = other.center[to2];
              this.newCenter[to2] = this.center[from];
            }
            [this.center, this.newCenter] = [this.newCenter, this.center];
            return this;
          }
          // Multiply this Cube with another Cube, restricted to corners.
          cornerMultiply(other) {
            var from, k5, to2;
            for (to2 = k5 = 0; k5 <= 7; to2 = ++k5) {
              from = other.cp[to2];
              this.newCp[to2] = this.cp[from];
              this.newCo[to2] = (this.co[from] + other.co[to2]) % 3;
            }
            [this.cp, this.newCp] = [this.newCp, this.cp];
            [this.co, this.newCo] = [this.newCo, this.co];
            return this;
          }
          // Multiply this Cube with another Cube, restricted to edges
          edgeMultiply(other) {
            var from, k5, to2;
            for (to2 = k5 = 0; k5 <= 11; to2 = ++k5) {
              from = other.ep[to2];
              this.newEp[to2] = this.ep[from];
              this.newEo[to2] = (this.eo[from] + other.eo[to2]) % 2;
            }
            [this.ep, this.newEp] = [this.newEp, this.ep];
            [this.eo, this.newEo] = [this.newEo, this.eo];
            return this;
          }
          // Multiply this cube with another Cube
          multiply(other) {
            this.centerMultiply(other);
            this.cornerMultiply(other);
            this.edgeMultiply(other);
            return this;
          }
          move(arg) {
            var face, k5, l, len, move, power, ref, ref1, x;
            ref = parseAlg(arg);
            for (k5 = 0, len = ref.length; k5 < len; k5++) {
              move = ref[k5];
              face = move / 3 | 0;
              power = move % 3;
              for (x = l = 0, ref1 = power; 0 <= ref1 ? l <= ref1 : l >= ref1; x = 0 <= ref1 ? ++l : --l) {
                this.multiply(Cube3.moves[face]);
              }
            }
            return this;
          }
          upright() {
            var clone, i, j2, k5, l, result;
            clone = this.clone();
            result = [];
            for (i = k5 = 0; k5 <= 5; i = ++k5) {
              if (clone.center[i] === F) {
                break;
              }
            }
            switch (i) {
              case D:
                result.push("x");
                break;
              case U2:
                result.push("x'");
                break;
              case B:
                result.push("x2");
                break;
              case R:
                result.push("y");
                break;
              case L:
                result.push("y'");
            }
            if (result.length) {
              clone.move(result[0]);
            }
            for (j2 = l = 0; l <= 5; j2 = ++l) {
              if (clone.center[j2] === U2) {
                break;
              }
            }
            switch (j2) {
              case L:
                result.push("z");
                break;
              case R:
                result.push("z'");
                break;
              case D:
                result.push("z2");
            }
            return result.join(" ");
          }
          static inverse(arg) {
            var face, k5, len, move, power, result, str;
            result = function() {
              var k6, len2, ref, results;
              ref = parseAlg(arg);
              results = [];
              for (k6 = 0, len2 = ref.length; k6 < len2; k6++) {
                move = ref[k6];
                face = move / 3 | 0;
                power = move % 3;
                results.push(face * 3 + -(power - 1) + 1);
              }
              return results;
            }();
            result.reverse();
            if (typeof arg === "string") {
              str = "";
              for (k5 = 0, len = result.length; k5 < len; k5++) {
                move = result[k5];
                face = move / 3 | 0;
                power = move % 3;
                str += faceNames[face];
                if (power === 1) {
                  str += "2";
                } else if (power === 2) {
                  str += "'";
                }
                str += " ";
              }
              return str.substring(0, str.length - 1);
            } else if (arg.length != null) {
              return result;
            } else {
              return result[0];
            }
          }
        }
        ;
        Cube3.prototype.randomize = function() {
          var arePermutationsValid, generateValidRandomOrientation, generateValidRandomPermutation, getNumSwaps, isOrientationValid, randint, randomizeOrientation, result, shuffle;
          randint = function(min, max) {
            return min + Math.floor(Math.random() * (max - min + 1));
          };
          shuffle = function(array) {
            var currentIndex, randomIndex, temporaryValue;
            currentIndex = array.length;
            while (currentIndex !== 0) {
              randomIndex = randint(0, currentIndex - 1);
              currentIndex -= 1;
              temporaryValue = array[currentIndex];
              [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
            }
          };
          getNumSwaps = function(arr) {
            var cur, cycleLength, i, k5, numSwaps, ref, seen, x;
            numSwaps = 0;
            seen = function() {
              var k6, ref2, results;
              results = [];
              for (x = k6 = 0, ref2 = arr.length - 1; 0 <= ref2 ? k6 <= ref2 : k6 >= ref2; x = 0 <= ref2 ? ++k6 : --k6) {
                results.push(false);
              }
              return results;
            }();
            while (true) {
              cur = -1;
              for (i = k5 = 0, ref = arr.length - 1; 0 <= ref ? k5 <= ref : k5 >= ref; i = 0 <= ref ? ++k5 : --k5) {
                if (!seen[i]) {
                  cur = i;
                  break;
                }
              }
              if (cur === -1) {
                break;
              }
              cycleLength = 0;
              while (!seen[cur]) {
                seen[cur] = true;
                cycleLength++;
                cur = arr[cur];
              }
              numSwaps += cycleLength + 1;
            }
            return numSwaps;
          };
          arePermutationsValid = function(cp, ep2) {
            var numSwaps;
            numSwaps = getNumSwaps(ep2) + getNumSwaps(cp);
            return numSwaps % 2 === 0;
          };
          generateValidRandomPermutation = function(cp, ep2) {
            shuffle(ep2);
            shuffle(cp);
            while (!arePermutationsValid(cp, ep2)) {
              shuffle(ep2);
              shuffle(cp);
            }
          };
          randomizeOrientation = function(arr, numOrientations) {
            var i, k5, ori, ref;
            ori = 0;
            for (i = k5 = 0, ref = arr.length - 1; 0 <= ref ? k5 <= ref : k5 >= ref; i = 0 <= ref ? ++k5 : --k5) {
              ori += arr[i] = randint(0, numOrientations - 1);
            }
          };
          isOrientationValid = function(arr, numOrientations) {
            return arr.reduce(function(a, b) {
              return a + b;
            }) % numOrientations === 0;
          };
          generateValidRandomOrientation = function(co2, eo2) {
            randomizeOrientation(co2, 3);
            while (!isOrientationValid(co2, 3)) {
              randomizeOrientation(co2, 3);
            }
            randomizeOrientation(eo2, 2);
            while (!isOrientationValid(eo2, 2)) {
              randomizeOrientation(eo2, 2);
            }
          };
          result = function() {
            generateValidRandomPermutation(this.cp, this.ep);
            generateValidRandomOrientation(this.co, this.eo);
            return this;
          };
          return result;
        }();
        Cube3.moves = [
          {
            // U
            center: [0, 1, 2, 3, 4, 5],
            cp: [
              UBR,
              URF,
              UFL,
              ULB,
              DFR,
              DLF,
              DBL,
              DRB
            ],
            co: [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0
            ],
            ep: [
              UB,
              UR,
              UF,
              UL,
              DR,
              DF,
              DL,
              DB,
              FR,
              FL,
              BL,
              BR
            ],
            eo: [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0
            ]
          },
          {
            // R
            center: [0, 1, 2, 3, 4, 5],
            cp: [
              DFR,
              UFL,
              ULB,
              URF,
              DRB,
              DLF,
              DBL,
              UBR
            ],
            co: [
              2,
              0,
              0,
              1,
              1,
              0,
              0,
              2
            ],
            ep: [
              FR,
              UF,
              UL,
              UB,
              BR,
              DF,
              DL,
              DB,
              DR,
              FL,
              BL,
              UR
            ],
            eo: [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0
            ]
          },
          {
            // F
            center: [0, 1, 2, 3, 4, 5],
            cp: [
              UFL,
              DLF,
              ULB,
              UBR,
              URF,
              DFR,
              DBL,
              DRB
            ],
            co: [
              1,
              2,
              0,
              0,
              2,
              1,
              0,
              0
            ],
            ep: [
              UR,
              FL,
              UL,
              UB,
              DR,
              FR,
              DL,
              DB,
              UF,
              DF,
              BL,
              BR
            ],
            eo: [
              0,
              1,
              0,
              0,
              0,
              1,
              0,
              0,
              1,
              1,
              0,
              0
            ]
          },
          {
            // D
            center: [0, 1, 2, 3, 4, 5],
            cp: [
              URF,
              UFL,
              ULB,
              UBR,
              DLF,
              DBL,
              DRB,
              DFR
            ],
            co: [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0
            ],
            ep: [
              UR,
              UF,
              UL,
              UB,
              DF,
              DL,
              DB,
              DR,
              FR,
              FL,
              BL,
              BR
            ],
            eo: [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0
            ]
          },
          {
            // L
            center: [0, 1, 2, 3, 4, 5],
            cp: [
              URF,
              ULB,
              DBL,
              UBR,
              DFR,
              UFL,
              DLF,
              DRB
            ],
            co: [
              0,
              1,
              2,
              0,
              0,
              2,
              1,
              0
            ],
            ep: [
              UR,
              UF,
              BL,
              UB,
              DR,
              DF,
              FL,
              DB,
              FR,
              UL,
              DL,
              BR
            ],
            eo: [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0
            ]
          },
          {
            // B
            center: [0, 1, 2, 3, 4, 5],
            cp: [
              URF,
              UFL,
              UBR,
              DRB,
              DFR,
              DLF,
              ULB,
              DBL
            ],
            co: [
              0,
              0,
              1,
              2,
              0,
              0,
              2,
              1
            ],
            ep: [
              UR,
              UF,
              UL,
              BR,
              DR,
              DF,
              DL,
              BL,
              FR,
              FL,
              UB,
              DB
            ],
            eo: [
              0,
              0,
              0,
              1,
              0,
              0,
              0,
              1,
              0,
              0,
              1,
              1
            ]
          },
          {
            // E
            center: [
              U2,
              F,
              L,
              D,
              B,
              R
            ],
            cp: [
              URF,
              UFL,
              ULB,
              UBR,
              DFR,
              DLF,
              DBL,
              DRB
            ],
            co: [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0
            ],
            ep: [
              UR,
              UF,
              UL,
              UB,
              DR,
              DF,
              DL,
              DB,
              FL,
              BL,
              BR,
              FR
            ],
            eo: [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              1,
              1,
              1,
              1
            ]
          },
          {
            // M
            center: [
              B,
              R,
              U2,
              F,
              L,
              D
            ],
            cp: [
              URF,
              UFL,
              ULB,
              UBR,
              DFR,
              DLF,
              DBL,
              DRB
            ],
            co: [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0
            ],
            ep: [
              UR,
              UB,
              UL,
              DB,
              DR,
              UF,
              DL,
              DF,
              FR,
              FL,
              BL,
              BR
            ],
            eo: [
              0,
              1,
              0,
              1,
              0,
              1,
              0,
              1,
              0,
              0,
              0,
              0
            ]
          },
          {
            // S
            center: [
              L,
              U2,
              F,
              R,
              D,
              B
            ],
            cp: [
              URF,
              UFL,
              ULB,
              UBR,
              DFR,
              DLF,
              DBL,
              DRB
            ],
            co: [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0
            ],
            ep: [
              UL,
              UF,
              DL,
              UB,
              UR,
              DF,
              DR,
              DB,
              FR,
              FL,
              BL,
              BR
            ],
            eo: [
              1,
              0,
              1,
              0,
              1,
              0,
              1,
              0,
              0,
              0,
              0,
              0
            ]
          }
        ];
        faceNums = {
          U: 0,
          R: 1,
          F: 2,
          D: 3,
          L: 4,
          B: 5,
          E: 6,
          M: 7,
          S: 8,
          x: 9,
          y: 10,
          z: 11,
          u: 12,
          r: 13,
          f: 14,
          d: 15,
          l: 16,
          b: 17
        };
        faceNames = {
          0: "U",
          1: "R",
          2: "F",
          3: "D",
          4: "L",
          5: "B",
          6: "E",
          7: "M",
          8: "S",
          9: "x",
          10: "y",
          11: "z",
          12: "u",
          13: "r",
          14: "f",
          15: "d",
          16: "l",
          17: "b"
        };
        parseAlg = function(arg) {
          var k5, len, move, part, power, ref, results;
          if (typeof arg === "string") {
            ref = arg.split(/\s+/);
            results = [];
            for (k5 = 0, len = ref.length; k5 < len; k5++) {
              part = ref[k5];
              if (part.length === 0) {
                continue;
              }
              if (part.length > 2) {
                throw new Error(`Invalid move: ${part}`);
              }
              move = faceNums[part[0]];
              if (move === void 0) {
                throw new Error(`Invalid move: ${part}`);
              }
              if (part.length === 1) {
                power = 0;
              } else {
                if (part[1] === "2") {
                  power = 1;
                } else if (part[1] === "'") {
                  power = 2;
                } else {
                  throw new Error(`Invalid move: ${part}`);
                }
              }
              results.push(move * 3 + power);
            }
            return results;
          } else if (arg.length != null) {
            return arg;
          } else {
            return [arg];
          }
        };
        Cube3.moves.push(new Cube3().move("R M' L'").toJSON());
        Cube3.moves.push(new Cube3().move("U E' D'").toJSON());
        Cube3.moves.push(new Cube3().move("F S B'").toJSON());
        Cube3.moves.push(new Cube3().move("U E'").toJSON());
        Cube3.moves.push(new Cube3().move("R M'").toJSON());
        Cube3.moves.push(new Cube3().move("F S").toJSON());
        Cube3.moves.push(new Cube3().move("D E").toJSON());
        Cube3.moves.push(new Cube3().move("L M").toJSON());
        Cube3.moves.push(new Cube3().move("B S'").toJSON());
        return Cube3;
      }.call(this);
      if (typeof module !== "undefined" && module !== null) {
        module.exports = Cube2;
      } else {
        this.Cube = Cube2;
      }
    }).call(exports);
  }
});

// node_modules/cubejs/lib/solve.js
var require_solve = __commonJS({
  "node_modules/cubejs/lib/solve.js"(exports) {
    (function() {
      var B, BL, BR, Cnk, Cube2, D, DB, DBL, DF, DFR, DL, DLF, DR, DRB, F, FL, FR, Include, L, N_FLIP, N_FRtoBR, N_PARITY, N_SLICE1, N_SLICE2, N_TWIST, N_UBtoDF, N_URFtoDLF, N_URtoDF, N_URtoUL, R, U2, UB, UBR, UF, UFL, UL, ULB, UR, URF, allMoves1, allMoves2, computeMoveTable, computePruningTable, faceNames, faceNums, factorial, key, max, mergeURtoDF, moveTableParams, nextMoves1, nextMoves2, permutationIndex, pruning, pruningTableParams, rotateLeft, rotateRight, value, indexOf = [].indexOf;
      Cube2 = this.Cube || require_cube();
      [U2, R, F, D, L, B] = [0, 1, 2, 3, 4, 5];
      [URF, UFL, ULB, UBR, DFR, DLF, DBL, DRB] = [0, 1, 2, 3, 4, 5, 6, 7];
      [UR, UF, UL, UB, DR, DF, DL, DB, FR, FL, BL, BR] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      Cnk = function(n, k5) {
        var i, j2, s;
        if (n < k5) {
          return 0;
        }
        if (k5 > n / 2) {
          k5 = n - k5;
        }
        s = 1;
        i = n;
        j2 = 1;
        while (i !== n - k5) {
          s *= i;
          s /= j2;
          i--;
          j2++;
        }
        return s;
      };
      factorial = function(n) {
        var f3, i, m, ref;
        f3 = 1;
        for (i = m = 2, ref = n; 2 <= ref ? m <= ref : m >= ref; i = 2 <= ref ? ++m : --m) {
          f3 *= i;
        }
        return f3;
      };
      max = function(a, b) {
        if (a > b) {
          return a;
        } else {
          return b;
        }
      };
      rotateLeft = function(array, l, r) {
        var i, m, ref, ref1, tmp;
        tmp = array[l];
        for (i = m = ref = l, ref1 = r - 1; ref <= ref1 ? m <= ref1 : m >= ref1; i = ref <= ref1 ? ++m : --m) {
          array[i] = array[i + 1];
        }
        return array[r] = tmp;
      };
      rotateRight = function(array, l, r) {
        var i, m, ref, ref1, tmp;
        tmp = array[r];
        for (i = m = ref = r, ref1 = l + 1; ref <= ref1 ? m <= ref1 : m >= ref1; i = ref <= ref1 ? ++m : --m) {
          array[i] = array[i - 1];
        }
        return array[l] = tmp;
      };
      permutationIndex = function(context, start, end, fromEnd = false) {
        var i, maxAll, maxB, maxOur, our, permName;
        maxOur = end - start;
        maxB = factorial(maxOur + 1);
        if (context === "corners") {
          maxAll = 7;
          permName = "cp";
        } else {
          maxAll = 11;
          permName = "ep";
        }
        our = function() {
          var m, ref, results;
          results = [];
          for (i = m = 0, ref = maxOur; 0 <= ref ? m <= ref : m >= ref; i = 0 <= ref ? ++m : --m) {
            results.push(0);
          }
          return results;
        }();
        return function(index) {
          var a, b, c2, j2, k5, m, o, p4, perm, q, ref, ref1, ref10, ref2, ref3, ref4, ref5, ref6, ref7, ref8, ref9, t, u, w, x, y, z;
          if (index != null) {
            for (i = m = 0, ref = maxOur; 0 <= ref ? m <= ref : m >= ref; i = 0 <= ref ? ++m : --m) {
              our[i] = i + start;
            }
            b = index % maxB;
            a = index / maxB | 0;
            perm = this[permName];
            for (i = o = 0, ref1 = maxAll; 0 <= ref1 ? o <= ref1 : o >= ref1; i = 0 <= ref1 ? ++o : --o) {
              perm[i] = -1;
            }
            for (j2 = p4 = 1, ref2 = maxOur; 1 <= ref2 ? p4 <= ref2 : p4 >= ref2; j2 = 1 <= ref2 ? ++p4 : --p4) {
              k5 = b % (j2 + 1);
              b = b / (j2 + 1) | 0;
              while (k5 > 0) {
                rotateRight(our, 0, j2);
                k5--;
              }
            }
            x = maxOur;
            if (fromEnd) {
              for (j2 = q = 0, ref3 = maxAll; 0 <= ref3 ? q <= ref3 : q >= ref3; j2 = 0 <= ref3 ? ++q : --q) {
                c2 = Cnk(maxAll - j2, x + 1);
                if (a - c2 >= 0) {
                  perm[j2] = our[maxOur - x];
                  a -= c2;
                  x--;
                }
              }
            } else {
              for (j2 = t = ref4 = maxAll; ref4 <= 0 ? t <= 0 : t >= 0; j2 = ref4 <= 0 ? ++t : --t) {
                c2 = Cnk(j2, x + 1);
                if (a - c2 >= 0) {
                  perm[j2] = our[x];
                  a -= c2;
                  x--;
                }
              }
            }
            return this;
          } else {
            perm = this[permName];
            for (i = u = 0, ref5 = maxOur; 0 <= ref5 ? u <= ref5 : u >= ref5; i = 0 <= ref5 ? ++u : --u) {
              our[i] = -1;
            }
            a = b = x = 0;
            if (fromEnd) {
              for (j2 = w = ref6 = maxAll; ref6 <= 0 ? w <= 0 : w >= 0; j2 = ref6 <= 0 ? ++w : --w) {
                if (start <= (ref7 = perm[j2]) && ref7 <= end) {
                  a += Cnk(maxAll - j2, x + 1);
                  our[maxOur - x] = perm[j2];
                  x++;
                }
              }
            } else {
              for (j2 = y = 0, ref8 = maxAll; 0 <= ref8 ? y <= ref8 : y >= ref8; j2 = 0 <= ref8 ? ++y : --y) {
                if (start <= (ref9 = perm[j2]) && ref9 <= end) {
                  a += Cnk(j2, x + 1);
                  our[x] = perm[j2];
                  x++;
                }
              }
            }
            for (j2 = z = ref10 = maxOur; ref10 <= 0 ? z <= 0 : z >= 0; j2 = ref10 <= 0 ? ++z : --z) {
              k5 = 0;
              while (our[j2] !== start + j2) {
                rotateLeft(our, 0, j2);
                k5++;
              }
              b = (j2 + 1) * b + k5;
            }
            return a * maxB + b;
          }
        };
      };
      Include = {
        // The twist of the 8 corners, 0 <= twist < 3^7. The orientation of
        // the DRB corner is fully determined by the orientation of the other
        // corners.
        twist: function(twist) {
          var i, m, o, ori, parity2, v;
          if (twist != null) {
            parity2 = 0;
            for (i = m = 6; m >= 0; i = --m) {
              ori = twist % 3;
              twist = twist / 3 | 0;
              this.co[i] = ori;
              parity2 += ori;
            }
            this.co[7] = (3 - parity2 % 3) % 3;
            return this;
          } else {
            v = 0;
            for (i = o = 0; o <= 6; i = ++o) {
              v = 3 * v + this.co[i];
            }
            return v;
          }
        },
        // The flip of the 12 edges, 0 <= flip < 2^11. The orientation of the
        // BR edge is fully determined by the orientation of the other edges.
        flip: function(flip) {
          var i, m, o, ori, parity2, v;
          if (flip != null) {
            parity2 = 0;
            for (i = m = 10; m >= 0; i = --m) {
              ori = flip % 2;
              flip = flip / 2 | 0;
              this.eo[i] = ori;
              parity2 += ori;
            }
            this.eo[11] = (2 - parity2 % 2) % 2;
            return this;
          } else {
            v = 0;
            for (i = o = 0; o <= 10; i = ++o) {
              v = 2 * v + this.eo[i];
            }
            return v;
          }
        },
        // Parity of the corner permutation
        cornerParity: function() {
          var i, j2, m, o, ref, ref1, ref2, ref3, s;
          s = 0;
          for (i = m = ref = DRB, ref1 = URF + 1; ref <= ref1 ? m <= ref1 : m >= ref1; i = ref <= ref1 ? ++m : --m) {
            for (j2 = o = ref2 = i - 1, ref3 = URF; ref2 <= ref3 ? o <= ref3 : o >= ref3; j2 = ref2 <= ref3 ? ++o : --o) {
              if (this.cp[j2] > this.cp[i]) {
                s++;
              }
            }
          }
          return s % 2;
        },
        // Parity of the edges permutation. Parity of corners and edges are
        // the same if the cube is solvable.
        edgeParity: function() {
          var i, j2, m, o, ref, ref1, ref2, ref3, s;
          s = 0;
          for (i = m = ref = BR, ref1 = UR + 1; ref <= ref1 ? m <= ref1 : m >= ref1; i = ref <= ref1 ? ++m : --m) {
            for (j2 = o = ref2 = i - 1, ref3 = UR; ref2 <= ref3 ? o <= ref3 : o >= ref3; j2 = ref2 <= ref3 ? ++o : --o) {
              if (this.ep[j2] > this.ep[i]) {
                s++;
              }
            }
          }
          return s % 2;
        },
        // Permutation of the six corners URF, UFL, ULB, UBR, DFR, DLF
        URFtoDLF: permutationIndex("corners", URF, DLF),
        // Permutation of the three edges UR, UF, UL
        URtoUL: permutationIndex("edges", UR, UL),
        // Permutation of the three edges UB, DR, DF
        UBtoDF: permutationIndex("edges", UB, DF),
        // Permutation of the six edges UR, UF, UL, UB, DR, DF
        URtoDF: permutationIndex("edges", UR, DF),
        // Permutation of the equator slice edges FR, FL, BL and BR
        FRtoBR: permutationIndex("edges", FR, BR, true)
      };
      for (key in Include) {
        value = Include[key];
        Cube2.prototype[key] = value;
      }
      computeMoveTable = function(context, coord, size) {
        var apply, cube, i, inner, j2, k5, m, move, o, p4, ref, results;
        apply = context === "corners" ? "cornerMultiply" : "edgeMultiply";
        cube = new Cube2();
        results = [];
        for (i = m = 0, ref = size - 1; 0 <= ref ? m <= ref : m >= ref; i = 0 <= ref ? ++m : --m) {
          cube[coord](i);
          inner = [];
          for (j2 = o = 0; o <= 5; j2 = ++o) {
            move = Cube2.moves[j2];
            for (k5 = p4 = 0; p4 <= 2; k5 = ++p4) {
              cube[apply](move);
              inner.push(cube[coord]());
            }
            cube[apply](move);
          }
          results.push(inner);
        }
        return results;
      };
      mergeURtoDF = function() {
        var a, b;
        a = new Cube2();
        b = new Cube2();
        return function(URtoUL, UBtoDF) {
          var i, m;
          a.URtoUL(URtoUL);
          b.UBtoDF(UBtoDF);
          for (i = m = 0; m <= 7; i = ++m) {
            if (a.ep[i] !== -1) {
              if (b.ep[i] !== -1) {
                return -1;
              } else {
                b.ep[i] = a.ep[i];
              }
            }
          }
          return b.URtoDF();
        };
      }();
      N_TWIST = 2187;
      N_FLIP = 2048;
      N_PARITY = 2;
      N_FRtoBR = 11880;
      N_SLICE1 = 495;
      N_SLICE2 = 24;
      N_URFtoDLF = 20160;
      N_URtoDF = 20160;
      N_URtoUL = 1320;
      N_UBtoDF = 1320;
      Cube2.moveTables = {
        parity: [[1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1], [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]],
        twist: null,
        flip: null,
        FRtoBR: null,
        URFtoDLF: null,
        URtoDF: null,
        URtoUL: null,
        UBtoDF: null,
        mergeURtoDF: null
      };
      moveTableParams = {
        // name: [scope, size]
        twist: ["corners", N_TWIST],
        flip: ["edges", N_FLIP],
        FRtoBR: ["edges", N_FRtoBR],
        URFtoDLF: ["corners", N_URFtoDLF],
        URtoDF: ["edges", N_URtoDF],
        URtoUL: ["edges", N_URtoUL],
        UBtoDF: ["edges", N_UBtoDF],
        mergeURtoDF: []
      };
      Cube2.computeMoveTables = function(...tables) {
        var len, m, name, scope, size, tableName;
        if (tables.length === 0) {
          tables = function() {
            var results;
            results = [];
            for (name in moveTableParams) {
              results.push(name);
            }
            return results;
          }();
        }
        for (m = 0, len = tables.length; m < len; m++) {
          tableName = tables[m];
          if (this.moveTables[tableName] !== null) {
            continue;
          }
          if (tableName === "mergeURtoDF") {
            this.moveTables.mergeURtoDF = function() {
              var UBtoDF, URtoUL, o, results;
              results = [];
              for (URtoUL = o = 0; o <= 335; URtoUL = ++o) {
                results.push(function() {
                  var p4, results1;
                  results1 = [];
                  for (UBtoDF = p4 = 0; p4 <= 335; UBtoDF = ++p4) {
                    results1.push(mergeURtoDF(URtoUL, UBtoDF));
                  }
                  return results1;
                }());
              }
              return results;
            }();
          } else {
            [scope, size] = moveTableParams[tableName];
            this.moveTables[tableName] = computeMoveTable(scope, tableName, size);
          }
        }
        return this;
      };
      allMoves1 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
      nextMoves1 = function() {
        var face, lastFace, m, next, o, p4, power, results;
        results = [];
        for (lastFace = m = 0; m <= 5; lastFace = ++m) {
          next = [];
          for (face = o = 0; o <= 5; face = ++o) {
            if (face !== lastFace && face !== lastFace - 3) {
              for (power = p4 = 0; p4 <= 2; power = ++p4) {
                next.push(face * 3 + power);
              }
            }
          }
          results.push(next);
        }
        return results;
      }();
      allMoves2 = [0, 1, 2, 4, 7, 9, 10, 11, 13, 16];
      nextMoves2 = function() {
        var face, lastFace, len, m, next, o, p4, power, powers, results;
        results = [];
        for (lastFace = m = 0; m <= 5; lastFace = ++m) {
          next = [];
          for (face = o = 0; o <= 5; face = ++o) {
            if (!(face !== lastFace && face !== lastFace - 3)) {
              continue;
            }
            powers = face === 0 || face === 3 ? [0, 1, 2] : [1];
            for (p4 = 0, len = powers.length; p4 < len; p4++) {
              power = powers[p4];
              next.push(face * 3 + power);
            }
          }
          results.push(next);
        }
        return results;
      }();
      pruning = function(table, index, value2) {
        var pos, shift, slot;
        pos = index % 8;
        slot = index >> 3;
        shift = pos << 2;
        if (value2 != null) {
          table[slot] &= ~(15 << shift);
          table[slot] |= value2 << shift;
          return value2;
        } else {
          return (table[slot] & 15 << shift) >>> shift;
        }
      };
      computePruningTable = function(phase, size, currentCoords, nextIndex) {
        var current, depth, done, index, len, m, move, moves, next, o, ref, table, x;
        table = function() {
          var m2, ref2, results;
          results = [];
          for (x = m2 = 0, ref2 = Math.ceil(size / 8) - 1; 0 <= ref2 ? m2 <= ref2 : m2 >= ref2; x = 0 <= ref2 ? ++m2 : --m2) {
            results.push(4294967295);
          }
          return results;
        }();
        if (phase === 1) {
          moves = allMoves1;
        } else {
          moves = allMoves2;
        }
        depth = 0;
        pruning(table, 0, depth);
        done = 1;
        while (done !== size) {
          for (index = m = 0, ref = size - 1; 0 <= ref ? m <= ref : m >= ref; index = 0 <= ref ? ++m : --m) {
            if (!(pruning(table, index) === depth)) {
              continue;
            }
            current = currentCoords(index);
            for (o = 0, len = moves.length; o < len; o++) {
              move = moves[o];
              next = nextIndex(current, move);
              if (pruning(table, next) === 15) {
                pruning(table, next, depth + 1);
                done++;
              }
            }
          }
          depth++;
        }
        return table;
      };
      Cube2.pruningTables = {
        sliceTwist: null,
        sliceFlip: null,
        sliceURFtoDLFParity: null,
        sliceURtoDFParity: null
      };
      pruningTableParams = {
        // name: [phase, size, currentCoords, nextIndex]
        sliceTwist: [
          1,
          N_SLICE1 * N_TWIST,
          function(index) {
            return [
              index % N_SLICE1,
              index / N_SLICE1 | 0
            ];
          },
          function(current, move) {
            var newSlice, newTwist, slice, twist;
            [
              slice,
              twist
            ] = current;
            newSlice = Cube2.moveTables.FRtoBR[slice * 24][move] / 24 | 0;
            newTwist = Cube2.moveTables.twist[twist][move];
            return newTwist * N_SLICE1 + newSlice;
          }
        ],
        sliceFlip: [
          1,
          N_SLICE1 * N_FLIP,
          function(index) {
            return [
              index % N_SLICE1,
              index / N_SLICE1 | 0
            ];
          },
          function(current, move) {
            var flip, newFlip, newSlice, slice;
            [
              slice,
              flip
            ] = current;
            newSlice = Cube2.moveTables.FRtoBR[slice * 24][move] / 24 | 0;
            newFlip = Cube2.moveTables.flip[flip][move];
            return newFlip * N_SLICE1 + newSlice;
          }
        ],
        sliceURFtoDLFParity: [
          2,
          N_SLICE2 * N_URFtoDLF * N_PARITY,
          function(index) {
            return [
              index % 2,
              (index / 2 | 0) % N_SLICE2,
              (index / 2 | 0) / N_SLICE2 | 0
            ];
          },
          function(current, move) {
            var URFtoDLF, newParity, newSlice, newURFtoDLF, parity2, slice;
            [
              parity2,
              slice,
              URFtoDLF
            ] = current;
            newParity = Cube2.moveTables.parity[parity2][move];
            newSlice = Cube2.moveTables.FRtoBR[slice][move];
            newURFtoDLF = Cube2.moveTables.URFtoDLF[URFtoDLF][move];
            return (newURFtoDLF * N_SLICE2 + newSlice) * 2 + newParity;
          }
        ],
        sliceURtoDFParity: [
          2,
          N_SLICE2 * N_URtoDF * N_PARITY,
          function(index) {
            return [
              index % 2,
              (index / 2 | 0) % N_SLICE2,
              (index / 2 | 0) / N_SLICE2 | 0
            ];
          },
          function(current, move) {
            var URtoDF, newParity, newSlice, newURtoDF, parity2, slice;
            [
              parity2,
              slice,
              URtoDF
            ] = current;
            newParity = Cube2.moveTables.parity[parity2][move];
            newSlice = Cube2.moveTables.FRtoBR[slice][move];
            newURtoDF = Cube2.moveTables.URtoDF[URtoDF][move];
            return (newURtoDF * N_SLICE2 + newSlice) * 2 + newParity;
          }
        ]
      };
      Cube2.computePruningTables = function(...tables) {
        var len, m, name, params, tableName;
        if (tables.length === 0) {
          tables = function() {
            var results;
            results = [];
            for (name in pruningTableParams) {
              results.push(name);
            }
            return results;
          }();
        }
        for (m = 0, len = tables.length; m < len; m++) {
          tableName = tables[m];
          if (this.pruningTables[tableName] !== null) {
            continue;
          }
          params = pruningTableParams[tableName];
          this.pruningTables[tableName] = computePruningTable(...params);
        }
        return this;
      };
      Cube2.initSolver = function() {
        Cube2.computeMoveTables();
        return Cube2.computePruningTables();
      };
      Cube2.prototype.solveUpright = function(maxDepth = 22) {
        var State, freeStates, moveNames, phase1, phase1search, phase2, phase2search, solution, state, x;
        moveNames = function() {
          var face, faceName, m, o, power, powerName, result;
          faceName = ["U", "R", "F", "D", "L", "B"];
          powerName = ["", "2", "'"];
          result = [];
          for (face = m = 0; m <= 5; face = ++m) {
            for (power = o = 0; o <= 2; power = ++o) {
              result.push(faceName[face] + powerName[power]);
            }
          }
          return result;
        }();
        State = class State {
          constructor(cube) {
            this.parent = null;
            this.lastMove = null;
            this.depth = 0;
            if (cube) {
              this.init(cube);
            }
          }
          init(cube) {
            this.flip = cube.flip();
            this.twist = cube.twist();
            this.slice = cube.FRtoBR() / N_SLICE2 | 0;
            this.parity = cube.cornerParity();
            this.URFtoDLF = cube.URFtoDLF();
            this.FRtoBR = cube.FRtoBR();
            this.URtoUL = cube.URtoUL();
            this.UBtoDF = cube.UBtoDF();
            return this;
          }
          solution() {
            if (this.parent) {
              return this.parent.solution() + moveNames[this.lastMove] + " ";
            } else {
              return "";
            }
          }
          //# Helpers
          move(table, index, move) {
            return Cube2.moveTables[table][index][move];
          }
          pruning(table, index) {
            return pruning(Cube2.pruningTables[table], index);
          }
          //# Phase 1
          // Return the next valid phase 1 moves for this state
          moves1() {
            if (this.lastMove !== null) {
              return nextMoves1[this.lastMove / 3 | 0];
            } else {
              return allMoves1;
            }
          }
          // Compute the minimum number of moves to the end of phase 1
          minDist1() {
            var d1, d2;
            d1 = this.pruning("sliceFlip", N_SLICE1 * this.flip + this.slice);
            d2 = this.pruning("sliceTwist", N_SLICE1 * this.twist + this.slice);
            return max(d1, d2);
          }
          // Compute the next phase 1 state for the given move
          next1(move) {
            var next;
            next = freeStates.pop();
            next.parent = this;
            next.lastMove = move;
            next.depth = this.depth + 1;
            next.flip = this.move("flip", this.flip, move);
            next.twist = this.move("twist", this.twist, move);
            next.slice = this.move("FRtoBR", this.slice * 24, move) / 24 | 0;
            return next;
          }
          //# Phase 2
          // Return the next valid phase 2 moves for this state
          moves2() {
            if (this.lastMove !== null) {
              return nextMoves2[this.lastMove / 3 | 0];
            } else {
              return allMoves2;
            }
          }
          // Compute the minimum number of moves to the solved cube
          minDist2() {
            var d1, d2, index1, index2;
            index1 = (N_SLICE2 * this.URtoDF + this.FRtoBR) * N_PARITY + this.parity;
            d1 = this.pruning("sliceURtoDFParity", index1);
            index2 = (N_SLICE2 * this.URFtoDLF + this.FRtoBR) * N_PARITY + this.parity;
            d2 = this.pruning("sliceURFtoDLFParity", index2);
            return max(d1, d2);
          }
          // Initialize phase 2 coordinates
          init2(top = true) {
            if (this.parent === null) {
              return;
            }
            this.parent.init2(false);
            this.URFtoDLF = this.move("URFtoDLF", this.parent.URFtoDLF, this.lastMove);
            this.FRtoBR = this.move("FRtoBR", this.parent.FRtoBR, this.lastMove);
            this.parity = this.move("parity", this.parent.parity, this.lastMove);
            this.URtoUL = this.move("URtoUL", this.parent.URtoUL, this.lastMove);
            this.UBtoDF = this.move("UBtoDF", this.parent.UBtoDF, this.lastMove);
            if (top) {
              return this.URtoDF = this.move("mergeURtoDF", this.URtoUL, this.UBtoDF);
            }
          }
          // Compute the next phase 2 state for the given move
          next2(move) {
            var next;
            next = freeStates.pop();
            next.parent = this;
            next.lastMove = move;
            next.depth = this.depth + 1;
            next.URFtoDLF = this.move("URFtoDLF", this.URFtoDLF, move);
            next.FRtoBR = this.move("FRtoBR", this.FRtoBR, move);
            next.parity = this.move("parity", this.parity, move);
            next.URtoDF = this.move("URtoDF", this.URtoDF, move);
            return next;
          }
        };
        solution = null;
        phase1search = function(state2) {
          var depth, m, ref, results;
          depth = 0;
          results = [];
          for (depth = m = 1, ref = maxDepth; 1 <= ref ? m <= ref : m >= ref; depth = 1 <= ref ? ++m : --m) {
            phase1(state2, depth);
            if (solution !== null) {
              break;
            }
            results.push(depth++);
          }
          return results;
        };
        phase1 = function(state2, depth) {
          var len, m, move, next, ref, ref1, results;
          if (depth === 0) {
            if (state2.minDist1() === 0) {
              if (state2.lastMove === null || (ref = state2.lastMove, indexOf.call(allMoves2, ref) < 0)) {
                return phase2search(state2);
              }
            }
          } else if (depth > 0) {
            if (state2.minDist1() <= depth) {
              ref1 = state2.moves1();
              results = [];
              for (m = 0, len = ref1.length; m < len; m++) {
                move = ref1[m];
                next = state2.next1(move);
                phase1(next, depth - 1);
                freeStates.push(next);
                if (solution !== null) {
                  break;
                } else {
                  results.push(void 0);
                }
              }
              return results;
            }
          }
        };
        phase2search = function(state2) {
          var depth, m, ref, results;
          state2.init2();
          results = [];
          for (depth = m = 1, ref = maxDepth - state2.depth; 1 <= ref ? m <= ref : m >= ref; depth = 1 <= ref ? ++m : --m) {
            phase2(state2, depth);
            if (solution !== null) {
              break;
            }
            results.push(depth++);
          }
          return results;
        };
        phase2 = function(state2, depth) {
          var len, m, move, next, ref, results;
          if (depth === 0) {
            if (state2.minDist2() === 0) {
              return solution = state2.solution();
            }
          } else if (depth > 0) {
            if (state2.minDist2() <= depth) {
              ref = state2.moves2();
              results = [];
              for (m = 0, len = ref.length; m < len; m++) {
                move = ref[m];
                next = state2.next2(move);
                phase2(next, depth - 1);
                freeStates.push(next);
                if (solution !== null) {
                  break;
                } else {
                  results.push(void 0);
                }
              }
              return results;
            }
          }
        };
        freeStates = function() {
          var m, ref, results;
          results = [];
          for (x = m = 0, ref = maxDepth + 1; 0 <= ref ? m <= ref : m >= ref; x = 0 <= ref ? ++m : --m) {
            results.push(new State());
          }
          return results;
        }();
        state = freeStates.pop().init(this);
        phase1search(state);
        freeStates.push(state);
        if (solution.length > 0) {
          solution = solution.substring(0, solution.length - 1);
        }
        return solution;
      };
      faceNums = {
        U: 0,
        R: 1,
        F: 2,
        D: 3,
        L: 4,
        B: 5
      };
      faceNames = {
        0: "U",
        1: "R",
        2: "F",
        3: "D",
        4: "L",
        5: "B"
      };
      Cube2.prototype.solve = function(maxDepth = 22) {
        var clone, len, m, move, ref, rotation, solution, upright, uprightSolution;
        clone = this.clone();
        upright = clone.upright();
        clone.move(upright);
        rotation = new Cube2().move(upright).center;
        uprightSolution = clone.solveUpright(maxDepth);
        solution = [];
        ref = uprightSolution.split(" ");
        for (m = 0, len = ref.length; m < len; m++) {
          move = ref[m];
          solution.push(faceNames[rotation[faceNums[move[0]]]]);
          if (move.length > 1) {
            solution[solution.length - 1] += move[1];
          }
        }
        return solution.join(" ");
      };
      Cube2.scramble = function() {
        return Cube2.inverse(Cube2.random().solve());
      };
    }).call(exports);
  }
});

// node_modules/cubejs/index.js
var require_cubejs = __commonJS({
  "node_modules/cubejs/index.js"(exports, module) {
    module.exports = require_cube();
    require_solve();
  }
});

// src/assemble.ts
var import_cubejs = __toESM(require_cubejs(), 1);

// node_modules/culori/src/rgb/parseNumber.js
var parseNumber = (color, len) => {
  if (typeof color !== "number") return;
  if (len === 3) {
    return {
      mode: "rgb",
      r: (color >> 8 & 15 | color >> 4 & 240) / 255,
      g: (color >> 4 & 15 | color & 240) / 255,
      b: (color & 15 | color << 4 & 240) / 255
    };
  }
  if (len === 4) {
    return {
      mode: "rgb",
      r: (color >> 12 & 15 | color >> 8 & 240) / 255,
      g: (color >> 8 & 15 | color >> 4 & 240) / 255,
      b: (color >> 4 & 15 | color & 240) / 255,
      alpha: (color & 15 | color << 4 & 240) / 255
    };
  }
  if (len === 6) {
    return {
      mode: "rgb",
      r: (color >> 16 & 255) / 255,
      g: (color >> 8 & 255) / 255,
      b: (color & 255) / 255
    };
  }
  if (len === 8) {
    return {
      mode: "rgb",
      r: (color >> 24 & 255) / 255,
      g: (color >> 16 & 255) / 255,
      b: (color >> 8 & 255) / 255,
      alpha: (color & 255) / 255
    };
  }
};
var parseNumber_default = parseNumber;

// node_modules/culori/src/colors/named.js
var named = {
  aliceblue: 15792383,
  antiquewhite: 16444375,
  aqua: 65535,
  aquamarine: 8388564,
  azure: 15794175,
  beige: 16119260,
  bisque: 16770244,
  black: 0,
  blanchedalmond: 16772045,
  blue: 255,
  blueviolet: 9055202,
  brown: 10824234,
  burlywood: 14596231,
  cadetblue: 6266528,
  chartreuse: 8388352,
  chocolate: 13789470,
  coral: 16744272,
  cornflowerblue: 6591981,
  cornsilk: 16775388,
  crimson: 14423100,
  cyan: 65535,
  darkblue: 139,
  darkcyan: 35723,
  darkgoldenrod: 12092939,
  darkgray: 11119017,
  darkgreen: 25600,
  darkgrey: 11119017,
  darkkhaki: 12433259,
  darkmagenta: 9109643,
  darkolivegreen: 5597999,
  darkorange: 16747520,
  darkorchid: 10040012,
  darkred: 9109504,
  darksalmon: 15308410,
  darkseagreen: 9419919,
  darkslateblue: 4734347,
  darkslategray: 3100495,
  darkslategrey: 3100495,
  darkturquoise: 52945,
  darkviolet: 9699539,
  deeppink: 16716947,
  deepskyblue: 49151,
  dimgray: 6908265,
  dimgrey: 6908265,
  dodgerblue: 2003199,
  firebrick: 11674146,
  floralwhite: 16775920,
  forestgreen: 2263842,
  fuchsia: 16711935,
  gainsboro: 14474460,
  ghostwhite: 16316671,
  gold: 16766720,
  goldenrod: 14329120,
  gray: 8421504,
  green: 32768,
  greenyellow: 11403055,
  grey: 8421504,
  honeydew: 15794160,
  hotpink: 16738740,
  indianred: 13458524,
  indigo: 4915330,
  ivory: 16777200,
  khaki: 15787660,
  lavender: 15132410,
  lavenderblush: 16773365,
  lawngreen: 8190976,
  lemonchiffon: 16775885,
  lightblue: 11393254,
  lightcoral: 15761536,
  lightcyan: 14745599,
  lightgoldenrodyellow: 16448210,
  lightgray: 13882323,
  lightgreen: 9498256,
  lightgrey: 13882323,
  lightpink: 16758465,
  lightsalmon: 16752762,
  lightseagreen: 2142890,
  lightskyblue: 8900346,
  lightslategray: 7833753,
  lightslategrey: 7833753,
  lightsteelblue: 11584734,
  lightyellow: 16777184,
  lime: 65280,
  limegreen: 3329330,
  linen: 16445670,
  magenta: 16711935,
  maroon: 8388608,
  mediumaquamarine: 6737322,
  mediumblue: 205,
  mediumorchid: 12211667,
  mediumpurple: 9662683,
  mediumseagreen: 3978097,
  mediumslateblue: 8087790,
  mediumspringgreen: 64154,
  mediumturquoise: 4772300,
  mediumvioletred: 13047173,
  midnightblue: 1644912,
  mintcream: 16121850,
  mistyrose: 16770273,
  moccasin: 16770229,
  navajowhite: 16768685,
  navy: 128,
  oldlace: 16643558,
  olive: 8421376,
  olivedrab: 7048739,
  orange: 16753920,
  orangered: 16729344,
  orchid: 14315734,
  palegoldenrod: 15657130,
  palegreen: 10025880,
  paleturquoise: 11529966,
  palevioletred: 14381203,
  papayawhip: 16773077,
  peachpuff: 16767673,
  peru: 13468991,
  pink: 16761035,
  plum: 14524637,
  powderblue: 11591910,
  purple: 8388736,
  // Added in CSS Colors Level 4:
  // https://drafts.csswg.org/css-color/#changes-from-3
  rebeccapurple: 6697881,
  red: 16711680,
  rosybrown: 12357519,
  royalblue: 4286945,
  saddlebrown: 9127187,
  salmon: 16416882,
  sandybrown: 16032864,
  seagreen: 3050327,
  seashell: 16774638,
  sienna: 10506797,
  silver: 12632256,
  skyblue: 8900331,
  slateblue: 6970061,
  slategray: 7372944,
  slategrey: 7372944,
  snow: 16775930,
  springgreen: 65407,
  steelblue: 4620980,
  tan: 13808780,
  teal: 32896,
  thistle: 14204888,
  tomato: 16737095,
  turquoise: 4251856,
  violet: 15631086,
  wheat: 16113331,
  white: 16777215,
  whitesmoke: 16119285,
  yellow: 16776960,
  yellowgreen: 10145074
};
var named_default = named;

// node_modules/culori/src/rgb/parseNamed.js
var parseNamed = (color) => {
  return parseNumber_default(named_default[color.toLowerCase()], 6);
};
var parseNamed_default = parseNamed;

// node_modules/culori/src/rgb/parseHex.js
var hex = /^#?([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})$/i;
var parseHex = (color) => {
  let match;
  return (match = color.match(hex)) ? parseNumber_default(parseInt(match[1], 16), match[1].length) : void 0;
};
var parseHex_default = parseHex;

// node_modules/culori/src/util/regex.js
var num = "([+-]?\\d*\\.?\\d+(?:[eE][+-]?\\d+)?)";
var num_none = `(?:${num}|none)`;
var per = `${num}%`;
var per_none = `(?:${num}%|none)`;
var num_per = `(?:${num}%|${num})`;
var num_per_none = `(?:${num}%|${num}|none)`;
var hue = `(?:${num}(deg|grad|rad|turn)|${num})`;
var hue_none = `(?:${num}(deg|grad|rad|turn)|${num}|none)`;
var c = `\\s*,\\s*`;
var rx_num_per_none = new RegExp("^" + num_per_none + "$");

// node_modules/culori/src/rgb/parseRgbLegacy.js
var rgb_num_old = new RegExp(
  `^rgba?\\(\\s*${num}${c}${num}${c}${num}\\s*(?:,\\s*${num_per}\\s*)?\\)$`
);
var rgb_per_old = new RegExp(
  `^rgba?\\(\\s*${per}${c}${per}${c}${per}\\s*(?:,\\s*${num_per}\\s*)?\\)$`
);
var parseRgbLegacy = (color) => {
  let res = { mode: "rgb" };
  let match;
  if (match = color.match(rgb_num_old)) {
    if (match[1] !== void 0) {
      res.r = match[1] / 255;
    }
    if (match[2] !== void 0) {
      res.g = match[2] / 255;
    }
    if (match[3] !== void 0) {
      res.b = match[3] / 255;
    }
  } else if (match = color.match(rgb_per_old)) {
    if (match[1] !== void 0) {
      res.r = match[1] / 100;
    }
    if (match[2] !== void 0) {
      res.g = match[2] / 100;
    }
    if (match[3] !== void 0) {
      res.b = match[3] / 100;
    }
  } else {
    return void 0;
  }
  if (match[4] !== void 0) {
    res.alpha = Math.max(0, Math.min(1, match[4] / 100));
  } else if (match[5] !== void 0) {
    res.alpha = Math.max(0, Math.min(1, +match[5]));
  }
  return res;
};
var parseRgbLegacy_default = parseRgbLegacy;

// node_modules/culori/src/_prepare.js
var prepare = (color, mode) => color === void 0 ? void 0 : typeof color !== "object" ? parse_default(color) : color.mode !== void 0 ? color : mode ? { ...color, mode } : void 0;
var prepare_default = prepare;

// node_modules/culori/src/converter.js
var converter = (target_mode = "rgb") => (color) => (color = prepare_default(color, target_mode)) !== void 0 ? (
  // if the color's mode corresponds to our target mode
  color.mode === target_mode ? (
    // then just return the color
    color
  ) : (
    // otherwise check to see if we have a dedicated
    // converter for the target mode
    converters[color.mode][target_mode] ? (
      // and return its result...
      converters[color.mode][target_mode](color)
    ) : (
      // ...otherwise pass through RGB as an intermediary step.
      // if the target mode is RGB...
      target_mode === "rgb" ? (
        // just return the RGB
        converters[color.mode].rgb(color)
      ) : (
        // otherwise convert color.mode -> RGB -> target_mode
        converters.rgb[target_mode](converters[color.mode].rgb(color))
      )
    )
  )
) : void 0;
var converter_default = converter;

// node_modules/culori/src/modes.js
var converters = {};
var modes = {};
var parsers = [];
var colorProfiles = {};
var identity = (v) => v;
var useMode = (definition29) => {
  converters[definition29.mode] = {
    ...converters[definition29.mode],
    ...definition29.toMode
  };
  Object.keys(definition29.fromMode || {}).forEach((k5) => {
    if (!converters[k5]) {
      converters[k5] = {};
    }
    converters[k5][definition29.mode] = definition29.fromMode[k5];
  });
  if (!definition29.ranges) {
    definition29.ranges = {};
  }
  if (!definition29.difference) {
    definition29.difference = {};
  }
  definition29.channels.forEach((channel) => {
    if (definition29.ranges[channel] === void 0) {
      definition29.ranges[channel] = [0, 1];
    }
    if (!definition29.interpolate[channel]) {
      throw new Error(`Missing interpolator for: ${channel}`);
    }
    if (typeof definition29.interpolate[channel] === "function") {
      definition29.interpolate[channel] = {
        use: definition29.interpolate[channel]
      };
    }
    if (!definition29.interpolate[channel].fixup) {
      definition29.interpolate[channel].fixup = identity;
    }
  });
  modes[definition29.mode] = definition29;
  (definition29.parse || []).forEach((parser) => {
    useParser(parser, definition29.mode);
  });
  return converter_default(definition29.mode);
};
var getMode = (mode) => modes[mode];
var useParser = (parser, mode) => {
  if (typeof parser === "string") {
    if (!mode) {
      throw new Error(`'mode' required when 'parser' is a string`);
    }
    colorProfiles[parser] = mode;
  } else if (typeof parser === "function") {
    if (parsers.indexOf(parser) < 0) {
      parsers.push(parser);
    }
  }
};

// node_modules/culori/src/parse.js
var IdentStartCodePoint = /[^\x00-\x7F]|[a-zA-Z_]/;
var IdentCodePoint = /[^\x00-\x7F]|[-\w]/;
var Tok = {
  Function: "function",
  Ident: "ident",
  Number: "number",
  Percentage: "percentage",
  ParenClose: ")",
  None: "none",
  Hue: "hue",
  Alpha: "alpha"
};
var _i = 0;
function is_num(chars) {
  let ch2 = chars[_i];
  let ch1 = chars[_i + 1];
  if (ch2 === "-" || ch2 === "+") {
    return /\d/.test(ch1) || ch1 === "." && /\d/.test(chars[_i + 2]);
  }
  if (ch2 === ".") {
    return /\d/.test(ch1);
  }
  return /\d/.test(ch2);
}
function is_ident(chars) {
  if (_i >= chars.length) {
    return false;
  }
  let ch2 = chars[_i];
  if (IdentStartCodePoint.test(ch2)) {
    return true;
  }
  if (ch2 === "-") {
    if (chars.length - _i < 2) {
      return false;
    }
    let ch1 = chars[_i + 1];
    if (ch1 === "-" || IdentStartCodePoint.test(ch1)) {
      return true;
    }
    return false;
  }
  return false;
}
var huenits = {
  deg: 1,
  rad: 180 / Math.PI,
  grad: 9 / 10,
  turn: 360
};
function num2(chars) {
  let value = "";
  if (chars[_i] === "-" || chars[_i] === "+") {
    value += chars[_i++];
  }
  value += digits(chars);
  if (chars[_i] === "." && /\d/.test(chars[_i + 1])) {
    value += chars[_i++] + digits(chars);
  }
  if (chars[_i] === "e" || chars[_i] === "E") {
    if ((chars[_i + 1] === "-" || chars[_i + 1] === "+") && /\d/.test(chars[_i + 2])) {
      value += chars[_i++] + chars[_i++] + digits(chars);
    } else if (/\d/.test(chars[_i + 1])) {
      value += chars[_i++] + digits(chars);
    }
  }
  if (is_ident(chars)) {
    let id = ident(chars);
    if (id === "deg" || id === "rad" || id === "turn" || id === "grad") {
      return { type: Tok.Hue, value: value * huenits[id] };
    }
    return void 0;
  }
  if (chars[_i] === "%") {
    _i++;
    return { type: Tok.Percentage, value: +value };
  }
  return { type: Tok.Number, value: +value };
}
function digits(chars) {
  let v = "";
  while (/\d/.test(chars[_i])) {
    v += chars[_i++];
  }
  return v;
}
function ident(chars) {
  let v = "";
  while (_i < chars.length && IdentCodePoint.test(chars[_i])) {
    v += chars[_i++];
  }
  return v;
}
function identlike(chars) {
  let v = ident(chars);
  if (chars[_i] === "(") {
    _i++;
    return { type: Tok.Function, value: v };
  }
  if (v === "none") {
    return { type: Tok.None, value: void 0 };
  }
  return { type: Tok.Ident, value: v };
}
function tokenize(str = "") {
  let chars = str.trim();
  let tokens = [];
  let ch2;
  _i = 0;
  while (_i < chars.length) {
    ch2 = chars[_i++];
    if (ch2 === "\n" || ch2 === "	" || ch2 === " ") {
      while (_i < chars.length && (chars[_i] === "\n" || chars[_i] === "	" || chars[_i] === " ")) {
        _i++;
      }
      continue;
    }
    if (ch2 === ",") {
      return void 0;
    }
    if (ch2 === ")") {
      tokens.push({ type: Tok.ParenClose });
      continue;
    }
    if (ch2 === "+") {
      _i--;
      if (is_num(chars)) {
        tokens.push(num2(chars));
        continue;
      }
      return void 0;
    }
    if (ch2 === "-") {
      _i--;
      if (is_num(chars)) {
        tokens.push(num2(chars));
        continue;
      }
      if (is_ident(chars)) {
        tokens.push({ type: Tok.Ident, value: ident(chars) });
        continue;
      }
      return void 0;
    }
    if (ch2 === ".") {
      _i--;
      if (is_num(chars)) {
        tokens.push(num2(chars));
        continue;
      }
      return void 0;
    }
    if (ch2 === "/") {
      while (_i < chars.length && (chars[_i] === "\n" || chars[_i] === "	" || chars[_i] === " ")) {
        _i++;
      }
      let alpha;
      if (is_num(chars)) {
        alpha = num2(chars);
        if (alpha.type !== Tok.Hue) {
          tokens.push({ type: Tok.Alpha, value: alpha });
          continue;
        }
      }
      if (is_ident(chars)) {
        if (ident(chars) === "none") {
          tokens.push({
            type: Tok.Alpha,
            value: { type: Tok.None, value: void 0 }
          });
          continue;
        }
      }
      return void 0;
    }
    if (/\d/.test(ch2)) {
      _i--;
      tokens.push(num2(chars));
      continue;
    }
    if (IdentStartCodePoint.test(ch2)) {
      _i--;
      tokens.push(identlike(chars));
      continue;
    }
    return void 0;
  }
  return tokens;
}
function parseColorSyntax(tokens) {
  tokens._i = 0;
  let token = tokens[tokens._i++];
  if (!token || token.type !== Tok.Function || token.value !== "color") {
    return void 0;
  }
  token = tokens[tokens._i++];
  if (token.type !== Tok.Ident) {
    return void 0;
  }
  const mode = colorProfiles[token.value];
  if (!mode) {
    return void 0;
  }
  const res = { mode };
  const coords = consumeCoords(tokens, false);
  if (!coords) {
    return void 0;
  }
  const channels = getMode(mode).channels;
  for (let ii = 0, c2, ch2; ii < channels.length; ii++) {
    c2 = coords[ii];
    ch2 = channels[ii];
    if (c2.type !== Tok.None) {
      res[ch2] = c2.type === Tok.Number ? c2.value : c2.value / 100;
      if (ch2 === "alpha") {
        res[ch2] = Math.max(0, Math.min(1, res[ch2]));
      }
    }
  }
  return res;
}
function consumeCoords(tokens, includeHue) {
  const coords = [];
  let token;
  while (tokens._i < tokens.length) {
    token = tokens[tokens._i++];
    if (token.type === Tok.None || token.type === Tok.Number || token.type === Tok.Alpha || token.type === Tok.Percentage || includeHue && token.type === Tok.Hue) {
      coords.push(token);
      continue;
    }
    if (token.type === Tok.ParenClose) {
      if (tokens._i < tokens.length) {
        return void 0;
      }
      continue;
    }
    return void 0;
  }
  if (coords.length < 3 || coords.length > 4) {
    return void 0;
  }
  if (coords.length === 4) {
    if (coords[3].type !== Tok.Alpha) {
      return void 0;
    }
    coords[3] = coords[3].value;
  }
  if (coords.length === 3) {
    coords.push({ type: Tok.None, value: void 0 });
  }
  return coords.every((c2) => c2.type !== Tok.Alpha) ? coords : void 0;
}
function parseModernSyntax(tokens, includeHue) {
  tokens._i = 0;
  let token = tokens[tokens._i++];
  if (!token || token.type !== Tok.Function) {
    return void 0;
  }
  let coords = consumeCoords(tokens, includeHue);
  if (!coords) {
    return void 0;
  }
  coords.unshift(token.value);
  return coords;
}
var parse = (color) => {
  if (typeof color !== "string") {
    return void 0;
  }
  const tokens = tokenize(color);
  const parsed = tokens ? parseModernSyntax(tokens, true) : void 0;
  let result = void 0;
  let i = 0;
  let len = parsers.length;
  while (i < len) {
    if ((result = parsers[i++](color, parsed)) !== void 0) {
      return result;
    }
  }
  return tokens ? parseColorSyntax(tokens) : void 0;
};
var parse_default = parse;

// node_modules/culori/src/rgb/parseRgb.js
function parseRgb(color, parsed) {
  if (!parsed || parsed[0] !== "rgb" && parsed[0] !== "rgba") {
    return void 0;
  }
  const res = { mode: "rgb" };
  const [, r, g, b, alpha] = parsed;
  if (r.type === Tok.Hue || g.type === Tok.Hue || b.type === Tok.Hue) {
    return void 0;
  }
  if (r.type !== Tok.None) {
    res.r = r.type === Tok.Number ? r.value / 255 : r.value / 100;
  }
  if (g.type !== Tok.None) {
    res.g = g.type === Tok.Number ? g.value / 255 : g.value / 100;
  }
  if (b.type !== Tok.None) {
    res.b = b.type === Tok.Number ? b.value / 255 : b.value / 100;
  }
  if (alpha.type !== Tok.None) {
    res.alpha = Math.min(
      1,
      Math.max(
        0,
        alpha.type === Tok.Number ? alpha.value : alpha.value / 100
      )
    );
  }
  return res;
}
var parseRgb_default = parseRgb;

// node_modules/culori/src/rgb/parseTransparent.js
var parseTransparent = (c2) => c2 === "transparent" ? { mode: "rgb", r: 0, g: 0, b: 0, alpha: 0 } : void 0;
var parseTransparent_default = parseTransparent;

// node_modules/culori/src/interpolate/lerp.js
var lerp = (a, b, t) => a + t * (b - a);

// node_modules/culori/src/interpolate/piecewise.js
var get_classes = (arr) => {
  let classes = [];
  for (let i = 0; i < arr.length - 1; i++) {
    let a = arr[i];
    let b = arr[i + 1];
    if (a === void 0 && b === void 0) {
      classes.push(void 0);
    } else if (a !== void 0 && b !== void 0) {
      classes.push([a, b]);
    } else {
      classes.push(a !== void 0 ? [a, a] : [b, b]);
    }
  }
  return classes;
};
var interpolatorPiecewise = (interpolator) => (arr) => {
  let classes = get_classes(arr);
  return (t) => {
    let cls = t * classes.length;
    let idx = t >= 1 ? classes.length - 1 : Math.max(Math.floor(cls), 0);
    let pair = classes[idx];
    return pair === void 0 ? void 0 : interpolator(pair[0], pair[1], cls - idx);
  };
};

// node_modules/culori/src/interpolate/linear.js
var interpolatorLinear = interpolatorPiecewise(lerp);

// node_modules/culori/src/fixup/alpha.js
var fixupAlpha = (arr) => {
  let some_defined = false;
  let res = arr.map((v) => {
    if (v !== void 0) {
      some_defined = true;
      return v;
    }
    return 1;
  });
  return some_defined ? res : arr;
};

// node_modules/culori/src/rgb/definition.js
var definition = {
  mode: "rgb",
  channels: ["r", "g", "b", "alpha"],
  parse: [
    parseRgb_default,
    parseHex_default,
    parseRgbLegacy_default,
    parseNamed_default,
    parseTransparent_default,
    "srgb"
  ],
  serialize: "srgb",
  interpolate: {
    r: interpolatorLinear,
    g: interpolatorLinear,
    b: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  },
  gamut: true,
  white: { r: 1, g: 1, b: 1 },
  black: { r: 0, g: 0, b: 0 }
};
var definition_default = definition;

// node_modules/culori/src/a98/convertA98ToXyz65.js
var linearize = (v = 0) => Math.pow(Math.abs(v), 563 / 256) * Math.sign(v);
var convertA98ToXyz65 = (a982) => {
  let r = linearize(a982.r);
  let g = linearize(a982.g);
  let b = linearize(a982.b);
  let res = {
    mode: "xyz65",
    x: 0.5766690429101305 * r + 0.1855582379065463 * g + 0.1882286462349947 * b,
    y: 0.297344975250536 * r + 0.6273635662554661 * g + 0.0752914584939979 * b,
    z: 0.0270313613864123 * r + 0.0706888525358272 * g + 0.9913375368376386 * b
  };
  if (a982.alpha !== void 0) {
    res.alpha = a982.alpha;
  }
  return res;
};
var convertA98ToXyz65_default = convertA98ToXyz65;

// node_modules/culori/src/a98/convertXyz65ToA98.js
var gamma = (v) => Math.pow(Math.abs(v), 256 / 563) * Math.sign(v);
var convertXyz65ToA98 = ({ x, y, z, alpha }) => {
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (z === void 0) z = 0;
  let res = {
    mode: "a98",
    r: gamma(
      x * 2.0415879038107465 - y * 0.5650069742788597 - 0.3447313507783297 * z
    ),
    g: gamma(
      x * -0.9692436362808798 + y * 1.8759675015077206 + 0.0415550574071756 * z
    ),
    b: gamma(
      x * 0.0134442806320312 - y * 0.1183623922310184 + 1.0151749943912058 * z
    )
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz65ToA98_default = convertXyz65ToA98;

// node_modules/culori/src/lrgb/convertRgbToLrgb.js
var fn = (c2 = 0) => {
  const abs2 = Math.abs(c2);
  if (abs2 <= 0.04045) {
    return c2 / 12.92;
  }
  return (Math.sign(c2) || 1) * Math.pow((abs2 + 0.055) / 1.055, 2.4);
};
var convertRgbToLrgb = ({ r, g, b, alpha }) => {
  let res = {
    mode: "lrgb",
    r: fn(r),
    g: fn(g),
    b: fn(b)
  };
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertRgbToLrgb_default = convertRgbToLrgb;

// node_modules/culori/src/xyz65/convertRgbToXyz65.js
var convertRgbToXyz65 = (rgb2) => {
  let { r, g, b, alpha } = convertRgbToLrgb_default(rgb2);
  let res = {
    mode: "xyz65",
    x: 0.4123907992659593 * r + 0.357584339383878 * g + 0.1804807884018343 * b,
    y: 0.2126390058715102 * r + 0.715168678767756 * g + 0.0721923153607337 * b,
    z: 0.0193308187155918 * r + 0.119194779794626 * g + 0.9505321522496607 * b
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertRgbToXyz65_default = convertRgbToXyz65;

// node_modules/culori/src/lrgb/convertLrgbToRgb.js
var fn2 = (c2 = 0) => {
  const abs2 = Math.abs(c2);
  if (abs2 > 31308e-7) {
    return (Math.sign(c2) || 1) * (1.055 * Math.pow(abs2, 1 / 2.4) - 0.055);
  }
  return c2 * 12.92;
};
var convertLrgbToRgb = ({ r, g, b, alpha }, mode = "rgb") => {
  let res = {
    mode,
    r: fn2(r),
    g: fn2(g),
    b: fn2(b)
  };
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertLrgbToRgb_default = convertLrgbToRgb;

// node_modules/culori/src/xyz65/convertXyz65ToRgb.js
var convertXyz65ToRgb = ({ x, y, z, alpha }) => {
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (z === void 0) z = 0;
  let res = convertLrgbToRgb_default({
    r: x * 3.2409699419045226 - y * 1.537383177570094 - 0.4986107602930034 * z,
    g: x * -0.9692436362808796 + y * 1.8759675015077204 + 0.0415550574071756 * z,
    b: x * 0.0556300796969936 - y * 0.2039769588889765 + 1.0569715142428784 * z
  });
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz65ToRgb_default = convertXyz65ToRgb;

// node_modules/culori/src/a98/definition.js
var definition2 = {
  ...definition_default,
  mode: "a98",
  parse: ["a98-rgb"],
  serialize: "a98-rgb",
  fromMode: {
    rgb: (color) => convertXyz65ToA98_default(convertRgbToXyz65_default(color)),
    xyz65: convertXyz65ToA98_default
  },
  toMode: {
    rgb: (color) => convertXyz65ToRgb_default(convertA98ToXyz65_default(color)),
    xyz65: convertA98ToXyz65_default
  }
};
var definition_default2 = definition2;

// node_modules/culori/src/util/normalizeHue.js
var normalizeHue = (hue3) => (hue3 = hue3 % 360) < 0 ? hue3 + 360 : hue3;
var normalizeHue_default = normalizeHue;

// node_modules/culori/src/fixup/hue.js
var hue2 = (hues, fn6) => {
  return hues.map((hue3, idx, arr) => {
    if (hue3 === void 0) {
      return hue3;
    }
    let normalized = normalizeHue_default(hue3);
    if (idx === 0 || hues[idx - 1] === void 0) {
      return normalized;
    }
    return fn6(normalized - normalizeHue_default(arr[idx - 1]));
  }).reduce((acc, curr) => {
    if (!acc.length || curr === void 0 || acc[acc.length - 1] === void 0) {
      acc.push(curr);
      return acc;
    }
    acc.push(curr + acc[acc.length - 1]);
    return acc;
  }, []);
};
var fixupHueShorter = (arr) => hue2(arr, (d) => Math.abs(d) <= 180 ? d : d - 360 * Math.sign(d));

// node_modules/culori/src/cubehelix/constants.js
var M = [-0.14861, 1.78277, -0.29227, -0.90649, 1.97294, 0];
var degToRad = Math.PI / 180;
var radToDeg = 180 / Math.PI;

// node_modules/culori/src/cubehelix/convertRgbToCubehelix.js
var DE = M[3] * M[4];
var BE = M[1] * M[4];
var BCAD = M[1] * M[2] - M[0] * M[3];
var convertRgbToCubehelix = ({ r, g, b, alpha }) => {
  if (r === void 0) r = 0;
  if (g === void 0) g = 0;
  if (b === void 0) b = 0;
  let l = (BCAD * b + r * DE - g * BE) / (BCAD + DE - BE);
  let x = b - l;
  let y = (M[4] * (g - l) - M[2] * x) / M[3];
  let res = {
    mode: "cubehelix",
    l,
    s: l === 0 || l === 1 ? void 0 : Math.sqrt(x * x + y * y) / (M[4] * l * (1 - l))
  };
  if (res.s) res.h = Math.atan2(y, x) * radToDeg - 120;
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertRgbToCubehelix_default = convertRgbToCubehelix;

// node_modules/culori/src/cubehelix/convertCubehelixToRgb.js
var convertCubehelixToRgb = ({ h, s, l, alpha }) => {
  let res = { mode: "rgb" };
  h = (h === void 0 ? 0 : h + 120) * degToRad;
  if (l === void 0) l = 0;
  let amp = s === void 0 ? 0 : s * l * (1 - l);
  let cosh = Math.cos(h);
  let sinh = Math.sin(h);
  res.r = l + amp * (M[0] * cosh + M[1] * sinh);
  res.g = l + amp * (M[2] * cosh + M[3] * sinh);
  res.b = l + amp * (M[4] * cosh + M[5] * sinh);
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertCubehelixToRgb_default = convertCubehelixToRgb;

// node_modules/culori/src/difference.js
var differenceHueSaturation = (std, smp) => {
  if (std.h === void 0 || smp.h === void 0 || !std.s || !smp.s) {
    return 0;
  }
  let std_h = normalizeHue_default(std.h);
  let smp_h = normalizeHue_default(smp.h);
  let dH = Math.sin((smp_h - std_h + 360) / 2 * Math.PI / 180);
  return 2 * Math.sqrt(std.s * smp.s) * dH;
};
var differenceHueNaive = (std, smp) => {
  if (std.h === void 0 || smp.h === void 0) {
    return 0;
  }
  let std_h = normalizeHue_default(std.h);
  let smp_h = normalizeHue_default(smp.h);
  if (Math.abs(smp_h - std_h) > 180) {
    return std_h - (smp_h - 360 * Math.sign(smp_h - std_h));
  }
  return smp_h - std_h;
};
var differenceHueChroma = (std, smp) => {
  if (std.h === void 0 || smp.h === void 0 || !std.c || !smp.c) {
    return 0;
  }
  let std_h = normalizeHue_default(std.h);
  let smp_h = normalizeHue_default(smp.h);
  let dH = Math.sin((smp_h - std_h + 360) / 2 * Math.PI / 180);
  return 2 * Math.sqrt(std.c * smp.c) * dH;
};
var differenceCiede2000 = (Kl2 = 1, Kc2 = 1, Kh2 = 1) => {
  let lab2 = converter_default("lab65");
  return (std, smp) => {
    let LabStd = lab2(std);
    let LabSmp = lab2(smp);
    let lStd = LabStd.l;
    let aStd = LabStd.a;
    let bStd = LabStd.b;
    let cStd = Math.sqrt(aStd * aStd + bStd * bStd);
    let lSmp = LabSmp.l;
    let aSmp = LabSmp.a;
    let bSmp = LabSmp.b;
    let cSmp = Math.sqrt(aSmp * aSmp + bSmp * bSmp);
    let cAvg = (cStd + cSmp) / 2;
    let G = 0.5 * (1 - Math.sqrt(
      Math.pow(cAvg, 7) / (Math.pow(cAvg, 7) + Math.pow(25, 7))
    ));
    let apStd = aStd * (1 + G);
    let apSmp = aSmp * (1 + G);
    let cpStd = Math.sqrt(apStd * apStd + bStd * bStd);
    let cpSmp = Math.sqrt(apSmp * apSmp + bSmp * bSmp);
    let hpStd = Math.abs(apStd) + Math.abs(bStd) === 0 ? 0 : Math.atan2(bStd, apStd);
    hpStd += (hpStd < 0) * 2 * Math.PI;
    let hpSmp = Math.abs(apSmp) + Math.abs(bSmp) === 0 ? 0 : Math.atan2(bSmp, apSmp);
    hpSmp += (hpSmp < 0) * 2 * Math.PI;
    let dL = lSmp - lStd;
    let dC = cpSmp - cpStd;
    let dhp = cpStd * cpSmp === 0 ? 0 : hpSmp - hpStd;
    dhp -= (dhp > Math.PI) * 2 * Math.PI;
    dhp += (dhp < -Math.PI) * 2 * Math.PI;
    let dH = 2 * Math.sqrt(cpStd * cpSmp) * Math.sin(dhp / 2);
    let Lp = (lStd + lSmp) / 2;
    let Cp = (cpStd + cpSmp) / 2;
    let hp;
    if (cpStd * cpSmp === 0) {
      hp = hpStd + hpSmp;
    } else {
      hp = (hpStd + hpSmp) / 2;
      hp -= (Math.abs(hpStd - hpSmp) > Math.PI) * Math.PI;
      hp += (hp < 0) * 2 * Math.PI;
    }
    let Lpm50 = Math.pow(Lp - 50, 2);
    let T = 1 - 0.17 * Math.cos(hp - Math.PI / 6) + 0.24 * Math.cos(2 * hp) + 0.32 * Math.cos(3 * hp + Math.PI / 30) - 0.2 * Math.cos(4 * hp - 63 * Math.PI / 180);
    let Sl2 = 1 + 0.015 * Lpm50 / Math.sqrt(20 + Lpm50);
    let Sc2 = 1 + 0.045 * Cp;
    let Sh2 = 1 + 0.015 * Cp * T;
    let deltaTheta = 30 * Math.PI / 180 * Math.exp(-1 * Math.pow((180 / Math.PI * hp - 275) / 25, 2));
    let Rc2 = 2 * Math.sqrt(Math.pow(Cp, 7) / (Math.pow(Cp, 7) + Math.pow(25, 7)));
    let Rt2 = -1 * Math.sin(2 * deltaTheta) * Rc2;
    return Math.sqrt(
      Math.pow(dL / (Kl2 * Sl2), 2) + Math.pow(dC / (Kc2 * Sc2), 2) + Math.pow(dH / (Kh2 * Sh2), 2) + Rt2 * dC / (Kc2 * Sc2) * dH / (Kh2 * Sh2)
    );
  };
};

// node_modules/culori/src/average.js
var averageAngle = (val) => {
  let sum = val.reduce(
    (sum2, val2) => {
      if (val2 !== void 0) {
        let rad = val2 * Math.PI / 180;
        sum2.sin += Math.sin(rad);
        sum2.cos += Math.cos(rad);
      }
      return sum2;
    },
    { sin: 0, cos: 0 }
  );
  let angle = Math.atan2(sum.sin, sum.cos) * 180 / Math.PI;
  return angle < 0 ? 360 + angle : angle;
};

// node_modules/culori/src/cubehelix/definition.js
var definition3 = {
  mode: "cubehelix",
  channels: ["h", "s", "l", "alpha"],
  parse: ["--cubehelix"],
  serialize: "--cubehelix",
  ranges: {
    h: [0, 360],
    s: [0, 4.614],
    l: [0, 1]
  },
  fromMode: {
    rgb: convertRgbToCubehelix_default
  },
  toMode: {
    rgb: convertCubehelixToRgb_default
  },
  interpolate: {
    h: {
      use: interpolatorLinear,
      fixup: fixupHueShorter
    },
    s: interpolatorLinear,
    l: interpolatorLinear,
    alpha: {
      use: interpolatorLinear,
      fixup: fixupAlpha
    }
  },
  difference: {
    h: differenceHueSaturation
  },
  average: {
    h: averageAngle
  }
};
var definition_default3 = definition3;

// node_modules/culori/src/lch/convertLabToLch.js
var convertLabToLch = ({ l, a, b, alpha }, mode = "lch") => {
  if (a === void 0) a = 0;
  if (b === void 0) b = 0;
  let c2 = Math.sqrt(a * a + b * b);
  let res = { mode, l, c: c2 };
  if (c2) res.h = normalizeHue_default(Math.atan2(b, a) * 180 / Math.PI);
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertLabToLch_default = convertLabToLch;

// node_modules/culori/src/lch/convertLchToLab.js
var convertLchToLab = ({ l, c: c2, h, alpha }, mode = "lab") => {
  if (h === void 0) h = 0;
  let res = {
    mode,
    l,
    a: c2 ? c2 * Math.cos(h / 180 * Math.PI) : 0,
    b: c2 ? c2 * Math.sin(h / 180 * Math.PI) : 0
  };
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertLchToLab_default = convertLchToLab;

// node_modules/culori/src/xyz65/constants.js
var k = Math.pow(29, 3) / Math.pow(3, 3);
var e = Math.pow(6, 3) / Math.pow(29, 3);

// node_modules/culori/src/constants.js
var D50 = {
  X: 0.3457 / 0.3585,
  Y: 1,
  Z: (1 - 0.3457 - 0.3585) / 0.3585
};
var D65 = {
  X: 0.3127 / 0.329,
  Y: 1,
  Z: (1 - 0.3127 - 0.329) / 0.329
};
var k2 = Math.pow(29, 3) / Math.pow(3, 3);
var e2 = Math.pow(6, 3) / Math.pow(29, 3);

// node_modules/culori/src/lab65/convertLab65ToXyz65.js
var fn3 = (v) => Math.pow(v, 3) > e ? Math.pow(v, 3) : (116 * v - 16) / k;
var convertLab65ToXyz65 = ({ l, a, b, alpha }) => {
  if (l === void 0) l = 0;
  if (a === void 0) a = 0;
  if (b === void 0) b = 0;
  let fy = (l + 16) / 116;
  let fx = a / 500 + fy;
  let fz = fy - b / 200;
  let res = {
    mode: "xyz65",
    x: fn3(fx) * D65.X,
    y: fn3(fy) * D65.Y,
    z: fn3(fz) * D65.Z
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertLab65ToXyz65_default = convertLab65ToXyz65;

// node_modules/culori/src/lab65/convertLab65ToRgb.js
var convertLab65ToRgb = (lab2) => convertXyz65ToRgb_default(convertLab65ToXyz65_default(lab2));
var convertLab65ToRgb_default = convertLab65ToRgb;

// node_modules/culori/src/lab65/convertXyz65ToLab65.js
var f = (value) => value > e ? Math.cbrt(value) : (k * value + 16) / 116;
var convertXyz65ToLab65 = ({ x, y, z, alpha }) => {
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (z === void 0) z = 0;
  let f0 = f(x / D65.X);
  let f1 = f(y / D65.Y);
  let f22 = f(z / D65.Z);
  let res = {
    mode: "lab65",
    l: 116 * f1 - 16,
    a: 500 * (f0 - f1),
    b: 200 * (f1 - f22)
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz65ToLab65_default = convertXyz65ToLab65;

// node_modules/culori/src/lab65/convertRgbToLab65.js
var convertRgbToLab65 = (rgb2) => {
  let res = convertXyz65ToLab65_default(convertRgbToXyz65_default(rgb2));
  if (rgb2.r === rgb2.b && rgb2.b === rgb2.g) {
    res.a = res.b = 0;
  }
  return res;
};
var convertRgbToLab65_default = convertRgbToLab65;

// node_modules/culori/src/dlch/constants.js
var kE = 1;
var kCH = 1;
var \u03B8 = 26 / 180 * Math.PI;
var cos\u03B8 = Math.cos(\u03B8);
var sin\u03B8 = Math.sin(\u03B8);
var factor = 100 / Math.log(139 / 100);

// node_modules/culori/src/dlch/convertDlchToLab65.js
var convertDlchToLab65 = ({ l, c: c2, h, alpha }) => {
  if (l === void 0) l = 0;
  if (c2 === void 0) c2 = 0;
  if (h === void 0) h = 0;
  let res = {
    mode: "lab65",
    l: (Math.exp(l * kE / factor) - 1) / 39e-4
  };
  let G = (Math.exp(0.0435 * c2 * kCH * kE) - 1) / 0.075;
  let e4 = G * Math.cos(h / 180 * Math.PI - \u03B8);
  let f3 = G * Math.sin(h / 180 * Math.PI - \u03B8);
  res.a = e4 * cos\u03B8 - f3 / 0.83 * sin\u03B8;
  res.b = e4 * sin\u03B8 + f3 / 0.83 * cos\u03B8;
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertDlchToLab65_default = convertDlchToLab65;

// node_modules/culori/src/dlch/convertLab65ToDlch.js
var convertLab65ToDlch = ({ l, a, b, alpha }) => {
  if (l === void 0) l = 0;
  if (a === void 0) a = 0;
  if (b === void 0) b = 0;
  let e4 = a * cos\u03B8 + b * sin\u03B8;
  let f3 = 0.83 * (b * cos\u03B8 - a * sin\u03B8);
  let G = Math.sqrt(e4 * e4 + f3 * f3);
  let res = {
    mode: "dlch",
    l: factor / kE * Math.log(1 + 39e-4 * l),
    c: Math.log(1 + 0.075 * G) / (0.0435 * kCH * kE)
  };
  if (res.c) {
    res.h = normalizeHue_default((Math.atan2(f3, e4) + \u03B8) / Math.PI * 180);
  }
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertLab65ToDlch_default = convertLab65ToDlch;

// node_modules/culori/src/dlab/definition.js
var convertDlabToLab65 = (c2) => convertDlchToLab65_default(convertLabToLch_default(c2, "dlch"));
var convertLab65ToDlab = (c2) => convertLchToLab_default(convertLab65ToDlch_default(c2), "dlab");
var definition4 = {
  mode: "dlab",
  parse: ["--din99o-lab"],
  serialize: "--din99o-lab",
  toMode: {
    lab65: convertDlabToLab65,
    rgb: (c2) => convertLab65ToRgb_default(convertDlabToLab65(c2))
  },
  fromMode: {
    lab65: convertLab65ToDlab,
    rgb: (c2) => convertLab65ToDlab(convertRgbToLab65_default(c2))
  },
  channels: ["l", "a", "b", "alpha"],
  ranges: {
    l: [0, 100],
    a: [-40.09, 45.501],
    b: [-40.469, 44.344]
  },
  interpolate: {
    l: interpolatorLinear,
    a: interpolatorLinear,
    b: interpolatorLinear,
    alpha: {
      use: interpolatorLinear,
      fixup: fixupAlpha
    }
  }
};
var definition_default4 = definition4;

// node_modules/culori/src/dlch/definition.js
var definition5 = {
  mode: "dlch",
  parse: ["--din99o-lch"],
  serialize: "--din99o-lch",
  toMode: {
    lab65: convertDlchToLab65_default,
    dlab: (c2) => convertLchToLab_default(c2, "dlab"),
    rgb: (c2) => convertLab65ToRgb_default(convertDlchToLab65_default(c2))
  },
  fromMode: {
    lab65: convertLab65ToDlch_default,
    dlab: (c2) => convertLabToLch_default(c2, "dlch"),
    rgb: (c2) => convertLab65ToDlch_default(convertRgbToLab65_default(c2))
  },
  channels: ["l", "c", "h", "alpha"],
  ranges: {
    l: [0, 100],
    c: [0, 51.484],
    h: [0, 360]
  },
  interpolate: {
    l: interpolatorLinear,
    c: interpolatorLinear,
    h: {
      use: interpolatorLinear,
      fixup: fixupHueShorter
    },
    alpha: {
      use: interpolatorLinear,
      fixup: fixupAlpha
    }
  },
  difference: {
    h: differenceHueChroma
  },
  average: {
    h: averageAngle
  }
};
var definition_default5 = definition5;

// node_modules/culori/src/hsi/convertHsiToRgb.js
function convertHsiToRgb({ h, s, i, alpha }) {
  h = normalizeHue_default(h !== void 0 ? h : 0);
  if (s === void 0) s = 0;
  if (i === void 0) i = 0;
  let f3 = Math.abs(h / 60 % 2 - 1);
  let res;
  switch (Math.floor(h / 60)) {
    case 0:
      res = {
        r: i * (1 + s * (3 / (2 - f3) - 1)),
        g: i * (1 + s * (3 * (1 - f3) / (2 - f3) - 1)),
        b: i * (1 - s)
      };
      break;
    case 1:
      res = {
        r: i * (1 + s * (3 * (1 - f3) / (2 - f3) - 1)),
        g: i * (1 + s * (3 / (2 - f3) - 1)),
        b: i * (1 - s)
      };
      break;
    case 2:
      res = {
        r: i * (1 - s),
        g: i * (1 + s * (3 / (2 - f3) - 1)),
        b: i * (1 + s * (3 * (1 - f3) / (2 - f3) - 1))
      };
      break;
    case 3:
      res = {
        r: i * (1 - s),
        g: i * (1 + s * (3 * (1 - f3) / (2 - f3) - 1)),
        b: i * (1 + s * (3 / (2 - f3) - 1))
      };
      break;
    case 4:
      res = {
        r: i * (1 + s * (3 * (1 - f3) / (2 - f3) - 1)),
        g: i * (1 - s),
        b: i * (1 + s * (3 / (2 - f3) - 1))
      };
      break;
    case 5:
      res = {
        r: i * (1 + s * (3 / (2 - f3) - 1)),
        g: i * (1 - s),
        b: i * (1 + s * (3 * (1 - f3) / (2 - f3) - 1))
      };
      break;
    default:
      res = { r: i * (1 - s), g: i * (1 - s), b: i * (1 - s) };
  }
  res.mode = "rgb";
  if (alpha !== void 0) res.alpha = alpha;
  return res;
}

// node_modules/culori/src/hsi/convertRgbToHsi.js
function convertRgbToHsi({ r, g, b, alpha }) {
  if (r === void 0) r = 0;
  if (g === void 0) g = 0;
  if (b === void 0) b = 0;
  let M3 = Math.max(r, g, b), m = Math.min(r, g, b);
  let res = {
    mode: "hsi",
    s: r + g + b === 0 ? 0 : 1 - 3 * m / (r + g + b),
    i: (r + g + b) / 3
  };
  if (M3 - m !== 0)
    res.h = (M3 === r ? (g - b) / (M3 - m) + (g < b) * 6 : M3 === g ? (b - r) / (M3 - m) + 2 : (r - g) / (M3 - m) + 4) * 60;
  if (alpha !== void 0) res.alpha = alpha;
  return res;
}

// node_modules/culori/src/hsi/definition.js
var definition6 = {
  mode: "hsi",
  toMode: {
    rgb: convertHsiToRgb
  },
  parse: ["--hsi"],
  serialize: "--hsi",
  fromMode: {
    rgb: convertRgbToHsi
  },
  channels: ["h", "s", "i", "alpha"],
  ranges: {
    h: [0, 360]
  },
  gamut: "rgb",
  interpolate: {
    h: { use: interpolatorLinear, fixup: fixupHueShorter },
    s: interpolatorLinear,
    i: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  },
  difference: {
    h: differenceHueSaturation
  },
  average: {
    h: averageAngle
  }
};
var definition_default6 = definition6;

// node_modules/culori/src/hsl/convertHslToRgb.js
function convertHslToRgb({ h, s, l, alpha }) {
  h = normalizeHue_default(h !== void 0 ? h : 0);
  if (s === void 0) s = 0;
  if (l === void 0) l = 0;
  let m1 = l + s * (l < 0.5 ? l : 1 - l);
  let m2 = m1 - (m1 - l) * 2 * Math.abs(h / 60 % 2 - 1);
  let res;
  switch (Math.floor(h / 60)) {
    case 0:
      res = { r: m1, g: m2, b: 2 * l - m1 };
      break;
    case 1:
      res = { r: m2, g: m1, b: 2 * l - m1 };
      break;
    case 2:
      res = { r: 2 * l - m1, g: m1, b: m2 };
      break;
    case 3:
      res = { r: 2 * l - m1, g: m2, b: m1 };
      break;
    case 4:
      res = { r: m2, g: 2 * l - m1, b: m1 };
      break;
    case 5:
      res = { r: m1, g: 2 * l - m1, b: m2 };
      break;
    default:
      res = { r: 2 * l - m1, g: 2 * l - m1, b: 2 * l - m1 };
  }
  res.mode = "rgb";
  if (alpha !== void 0) res.alpha = alpha;
  return res;
}

// node_modules/culori/src/hsl/convertRgbToHsl.js
function convertRgbToHsl({ r, g, b, alpha }) {
  if (r === void 0) r = 0;
  if (g === void 0) g = 0;
  if (b === void 0) b = 0;
  let M3 = Math.max(r, g, b), m = Math.min(r, g, b);
  let res = {
    mode: "hsl",
    s: M3 === m ? 0 : (M3 - m) / (1 - Math.abs(M3 + m - 1)),
    l: 0.5 * (M3 + m)
  };
  if (M3 - m !== 0)
    res.h = (M3 === r ? (g - b) / (M3 - m) + (g < b) * 6 : M3 === g ? (b - r) / (M3 - m) + 2 : (r - g) / (M3 - m) + 4) * 60;
  if (alpha !== void 0) res.alpha = alpha;
  return res;
}

// node_modules/culori/src/util/hue.js
var hueToDeg = (val, unit) => {
  switch (unit) {
    case "deg":
      return +val;
    case "rad":
      return val / Math.PI * 180;
    case "grad":
      return val / 10 * 9;
    case "turn":
      return val * 360;
  }
};
var hue_default = hueToDeg;

// node_modules/culori/src/hsl/parseHslLegacy.js
var hsl_old = new RegExp(
  `^hsla?\\(\\s*${hue}${c}${per}${c}${per}\\s*(?:,\\s*${num_per}\\s*)?\\)$`
);
var parseHslLegacy = (color) => {
  let match = color.match(hsl_old);
  if (!match) return;
  let res = { mode: "hsl" };
  if (match[3] !== void 0) {
    res.h = +match[3];
  } else if (match[1] !== void 0 && match[2] !== void 0) {
    res.h = hue_default(match[1], match[2]);
  }
  if (match[4] !== void 0) {
    res.s = Math.min(Math.max(0, match[4] / 100), 1);
  }
  if (match[5] !== void 0) {
    res.l = Math.min(Math.max(0, match[5] / 100), 1);
  }
  if (match[6] !== void 0) {
    res.alpha = Math.max(0, Math.min(1, match[6] / 100));
  } else if (match[7] !== void 0) {
    res.alpha = Math.max(0, Math.min(1, +match[7]));
  }
  return res;
};
var parseHslLegacy_default = parseHslLegacy;

// node_modules/culori/src/hsl/parseHsl.js
function parseHsl(color, parsed) {
  if (!parsed || parsed[0] !== "hsl" && parsed[0] !== "hsla") {
    return void 0;
  }
  const res = { mode: "hsl" };
  const [, h, s, l, alpha] = parsed;
  if (h.type !== Tok.None) {
    if (h.type === Tok.Percentage) {
      return void 0;
    }
    res.h = h.value;
  }
  if (s.type !== Tok.None) {
    if (s.type === Tok.Hue) {
      return void 0;
    }
    res.s = s.value / 100;
  }
  if (l.type !== Tok.None) {
    if (l.type === Tok.Hue) {
      return void 0;
    }
    res.l = l.value / 100;
  }
  if (alpha.type !== Tok.None) {
    res.alpha = Math.min(
      1,
      Math.max(
        0,
        alpha.type === Tok.Number ? alpha.value : alpha.value / 100
      )
    );
  }
  return res;
}
var parseHsl_default = parseHsl;

// node_modules/culori/src/hsl/definition.js
var definition7 = {
  mode: "hsl",
  toMode: {
    rgb: convertHslToRgb
  },
  fromMode: {
    rgb: convertRgbToHsl
  },
  channels: ["h", "s", "l", "alpha"],
  ranges: {
    h: [0, 360]
  },
  gamut: "rgb",
  parse: [parseHsl_default, parseHslLegacy_default],
  serialize: (c2) => `hsl(${c2.h !== void 0 ? c2.h : "none"} ${c2.s !== void 0 ? c2.s * 100 + "%" : "none"} ${c2.l !== void 0 ? c2.l * 100 + "%" : "none"}${c2.alpha < 1 ? ` / ${c2.alpha}` : ""})`,
  interpolate: {
    h: { use: interpolatorLinear, fixup: fixupHueShorter },
    s: interpolatorLinear,
    l: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  },
  difference: {
    h: differenceHueSaturation
  },
  average: {
    h: averageAngle
  }
};
var definition_default7 = definition7;

// node_modules/culori/src/hsv/convertHsvToRgb.js
function convertHsvToRgb({ h, s, v, alpha }) {
  h = normalizeHue_default(h !== void 0 ? h : 0);
  if (s === void 0) s = 0;
  if (v === void 0) v = 0;
  let f3 = Math.abs(h / 60 % 2 - 1);
  let res;
  switch (Math.floor(h / 60)) {
    case 0:
      res = { r: v, g: v * (1 - s * f3), b: v * (1 - s) };
      break;
    case 1:
      res = { r: v * (1 - s * f3), g: v, b: v * (1 - s) };
      break;
    case 2:
      res = { r: v * (1 - s), g: v, b: v * (1 - s * f3) };
      break;
    case 3:
      res = { r: v * (1 - s), g: v * (1 - s * f3), b: v };
      break;
    case 4:
      res = { r: v * (1 - s * f3), g: v * (1 - s), b: v };
      break;
    case 5:
      res = { r: v, g: v * (1 - s), b: v * (1 - s * f3) };
      break;
    default:
      res = { r: v * (1 - s), g: v * (1 - s), b: v * (1 - s) };
  }
  res.mode = "rgb";
  if (alpha !== void 0) res.alpha = alpha;
  return res;
}

// node_modules/culori/src/hsv/convertRgbToHsv.js
function convertRgbToHsv({ r, g, b, alpha }) {
  if (r === void 0) r = 0;
  if (g === void 0) g = 0;
  if (b === void 0) b = 0;
  let M3 = Math.max(r, g, b), m = Math.min(r, g, b);
  let res = {
    mode: "hsv",
    s: M3 === 0 ? 0 : 1 - m / M3,
    v: M3
  };
  if (M3 - m !== 0)
    res.h = (M3 === r ? (g - b) / (M3 - m) + (g < b) * 6 : M3 === g ? (b - r) / (M3 - m) + 2 : (r - g) / (M3 - m) + 4) * 60;
  if (alpha !== void 0) res.alpha = alpha;
  return res;
}

// node_modules/culori/src/hsv/definition.js
var definition8 = {
  mode: "hsv",
  toMode: {
    rgb: convertHsvToRgb
  },
  parse: ["--hsv"],
  serialize: "--hsv",
  fromMode: {
    rgb: convertRgbToHsv
  },
  channels: ["h", "s", "v", "alpha"],
  ranges: {
    h: [0, 360]
  },
  gamut: "rgb",
  interpolate: {
    h: { use: interpolatorLinear, fixup: fixupHueShorter },
    s: interpolatorLinear,
    v: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  },
  difference: {
    h: differenceHueSaturation
  },
  average: {
    h: averageAngle
  }
};
var definition_default8 = definition8;

// node_modules/culori/src/hwb/convertHwbToRgb.js
function convertHwbToRgb({ h, w, b, alpha }) {
  if (w === void 0) w = 0;
  if (b === void 0) b = 0;
  if (w + b > 1) {
    let s = w + b;
    w /= s;
    b /= s;
  }
  return convertHsvToRgb({
    h,
    s: b === 1 ? 1 : 1 - w / (1 - b),
    v: 1 - b,
    alpha
  });
}

// node_modules/culori/src/hwb/convertRgbToHwb.js
function convertRgbToHwb(rgba) {
  let hsv2 = convertRgbToHsv(rgba);
  if (hsv2 === void 0) return void 0;
  let s = hsv2.s !== void 0 ? hsv2.s : 0;
  let v = hsv2.v !== void 0 ? hsv2.v : 0;
  let res = {
    mode: "hwb",
    w: (1 - s) * v,
    b: 1 - v
  };
  if (hsv2.h !== void 0) res.h = hsv2.h;
  if (hsv2.alpha !== void 0) res.alpha = hsv2.alpha;
  return res;
}

// node_modules/culori/src/hwb/parseHwb.js
function ParseHwb(color, parsed) {
  if (!parsed || parsed[0] !== "hwb") {
    return void 0;
  }
  const res = { mode: "hwb" };
  const [, h, w, b, alpha] = parsed;
  if (h.type !== Tok.None) {
    if (h.type === Tok.Percentage) {
      return void 0;
    }
    res.h = h.value;
  }
  if (w.type !== Tok.None) {
    if (w.type === Tok.Hue) {
      return void 0;
    }
    res.w = w.value / 100;
  }
  if (b.type !== Tok.None) {
    if (b.type === Tok.Hue) {
      return void 0;
    }
    res.b = b.value / 100;
  }
  if (alpha.type !== Tok.None) {
    res.alpha = Math.min(
      1,
      Math.max(
        0,
        alpha.type === Tok.Number ? alpha.value : alpha.value / 100
      )
    );
  }
  return res;
}
var parseHwb_default = ParseHwb;

// node_modules/culori/src/hwb/definition.js
var definition9 = {
  mode: "hwb",
  toMode: {
    rgb: convertHwbToRgb
  },
  fromMode: {
    rgb: convertRgbToHwb
  },
  channels: ["h", "w", "b", "alpha"],
  ranges: {
    h: [0, 360]
  },
  gamut: "rgb",
  parse: [parseHwb_default],
  serialize: (c2) => `hwb(${c2.h !== void 0 ? c2.h : "none"} ${c2.w !== void 0 ? c2.w * 100 + "%" : "none"} ${c2.b !== void 0 ? c2.b * 100 + "%" : "none"}${c2.alpha < 1 ? ` / ${c2.alpha}` : ""})`,
  interpolate: {
    h: { use: interpolatorLinear, fixup: fixupHueShorter },
    w: interpolatorLinear,
    b: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  },
  difference: {
    h: differenceHueNaive
  },
  average: {
    h: averageAngle
  }
};
var definition_default9 = definition9;

// node_modules/culori/src/hdr/constants.js
var YW = 203;

// node_modules/culori/src/hdr/transfer.js
var M1 = 0.1593017578125;
var M2 = 78.84375;
var C1 = 0.8359375;
var C2 = 18.8515625;
var C3 = 18.6875;
function transferPqDecode(v) {
  if (v < 0) return 0;
  const c2 = Math.pow(v, 1 / M2);
  return 1e4 * Math.pow(Math.max(0, c2 - C1) / (C2 - C3 * c2), 1 / M1);
}
function transferPqEncode(v) {
  if (v < 0) return 0;
  const c2 = Math.pow(v / 1e4, M1);
  return Math.pow((C1 + C2 * c2) / (1 + C3 * c2), M2);
}

// node_modules/culori/src/itp/convertItpToXyz65.js
var toRel = (c2) => Math.max(c2 / YW, 0);
var convertItpToXyz65 = ({ i, t, p: p4, alpha }) => {
  if (i === void 0) i = 0;
  if (t === void 0) t = 0;
  if (p4 === void 0) p4 = 0;
  const l = transferPqDecode(
    i + 0.008609037037932761 * t + 0.11102962500302593 * p4
  );
  const m = transferPqDecode(
    i - 0.00860903703793275 * t - 0.11102962500302599 * p4
  );
  const s = transferPqDecode(
    i + 0.5600313357106791 * t - 0.32062717498731885 * p4
  );
  const res = {
    mode: "xyz65",
    x: toRel(
      2.070152218389422 * l - 1.3263473389671556 * m + 0.2066510476294051 * s
    ),
    y: toRel(
      0.3647385209748074 * l + 0.680566024947227 * m - 0.0453045459220346 * s
    ),
    z: toRel(
      -0.049747207535812 * l - 0.0492609666966138 * m + 1.1880659249923042 * s
    )
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertItpToXyz65_default = convertItpToXyz65;

// node_modules/culori/src/itp/convertXyz65ToItp.js
var toAbs = (c2 = 0) => Math.max(c2 * YW, 0);
var convertXyz65ToItp = ({ x, y, z, alpha }) => {
  const absX = toAbs(x);
  const absY = toAbs(y);
  const absZ = toAbs(z);
  const l = transferPqEncode(
    0.3592832590121217 * absX + 0.6976051147779502 * absY - 0.0358915932320289 * absZ
  );
  const m = transferPqEncode(
    -0.1920808463704995 * absX + 1.1004767970374323 * absY + 0.0753748658519118 * absZ
  );
  const s = transferPqEncode(
    0.0070797844607477 * absX + 0.0748396662186366 * absY + 0.8433265453898765 * absZ
  );
  const i = 0.5 * l + 0.5 * m;
  const t = 1.61376953125 * l - 3.323486328125 * m + 1.709716796875 * s;
  const p4 = 4.378173828125 * l - 4.24560546875 * m - 0.132568359375 * s;
  const res = { mode: "itp", i, t, p: p4 };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz65ToItp_default = convertXyz65ToItp;

// node_modules/culori/src/itp/definition.js
var definition10 = {
  mode: "itp",
  channels: ["i", "t", "p", "alpha"],
  parse: ["--ictcp"],
  serialize: "--ictcp",
  toMode: {
    xyz65: convertItpToXyz65_default,
    rgb: (color) => convertXyz65ToRgb_default(convertItpToXyz65_default(color))
  },
  fromMode: {
    xyz65: convertXyz65ToItp_default,
    rgb: (color) => convertXyz65ToItp_default(convertRgbToXyz65_default(color))
  },
  ranges: {
    i: [0, 0.581],
    t: [-0.369, 0.272],
    p: [-0.164, 0.331]
  },
  interpolate: {
    i: interpolatorLinear,
    t: interpolatorLinear,
    p: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  }
};
var definition_default10 = definition10;

// node_modules/culori/src/jab/convertXyz65ToJab.js
var p = 134.03437499999998;
var d0 = 16295499532821565e-27;
var jabPqEncode = (v) => {
  if (v < 0) return 0;
  let vn3 = Math.pow(v / 1e4, M1);
  return Math.pow((C1 + C2 * vn3) / (1 + C3 * vn3), p);
};
var abs = (v = 0) => Math.max(v * 203, 0);
var convertXyz65ToJab = ({ x, y, z, alpha }) => {
  x = abs(x);
  y = abs(y);
  z = abs(z);
  let xp = 1.15 * x - 0.15 * z;
  let yp = 0.66 * y + 0.34 * x;
  let l = jabPqEncode(0.41478972 * xp + 0.579999 * yp + 0.014648 * z);
  let m = jabPqEncode(-0.20151 * xp + 1.120649 * yp + 0.0531008 * z);
  let s = jabPqEncode(-0.0166008 * xp + 0.2648 * yp + 0.6684799 * z);
  let i = (l + m) / 2;
  let res = {
    mode: "jab",
    j: 0.44 * i / (1 - 0.56 * i) - d0,
    a: 3.524 * l - 4.066708 * m + 0.542708 * s,
    b: 0.199076 * l + 1.096799 * m - 1.295875 * s
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz65ToJab_default = convertXyz65ToJab;

// node_modules/culori/src/jab/convertJabToXyz65.js
var p2 = 134.03437499999998;
var d02 = 16295499532821565e-27;
var jabPqDecode = (v) => {
  if (v < 0) return 0;
  let vp = Math.pow(v, 1 / p2);
  return 1e4 * Math.pow((C1 - vp) / (C3 * vp - C2), 1 / M1);
};
var rel = (v) => v / 203;
var convertJabToXyz65 = ({ j: j2, a, b, alpha }) => {
  if (j2 === void 0) j2 = 0;
  if (a === void 0) a = 0;
  if (b === void 0) b = 0;
  let i = (j2 + d02) / (0.44 + 0.56 * (j2 + d02));
  let l = jabPqDecode(i + 0.13860504 * a + 0.058047316 * b);
  let m = jabPqDecode(i - 0.13860504 * a - 0.058047316 * b);
  let s = jabPqDecode(i - 0.096019242 * a - 0.8118919 * b);
  let res = {
    mode: "xyz65",
    x: rel(
      1.661373024652174 * l - 0.914523081304348 * m + 0.23136208173913045 * s
    ),
    y: rel(
      -0.3250758611844533 * l + 1.571847026732543 * m - 0.21825383453227928 * s
    ),
    z: rel(-0.090982811 * l - 0.31272829 * m + 1.5227666 * s)
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertJabToXyz65_default = convertJabToXyz65;

// node_modules/culori/src/jab/convertRgbToJab.js
var convertRgbToJab = (rgb2) => {
  let res = convertXyz65ToJab_default(convertRgbToXyz65_default(rgb2));
  if (rgb2.r === rgb2.b && rgb2.b === rgb2.g) {
    res.a = res.b = 0;
  }
  return res;
};
var convertRgbToJab_default = convertRgbToJab;

// node_modules/culori/src/jab/convertJabToRgb.js
var convertJabToRgb = (color) => convertXyz65ToRgb_default(convertJabToXyz65_default(color));
var convertJabToRgb_default = convertJabToRgb;

// node_modules/culori/src/jab/definition.js
var definition11 = {
  mode: "jab",
  channels: ["j", "a", "b", "alpha"],
  parse: ["--jzazbz"],
  serialize: "--jzazbz",
  fromMode: {
    rgb: convertRgbToJab_default,
    xyz65: convertXyz65ToJab_default
  },
  toMode: {
    rgb: convertJabToRgb_default,
    xyz65: convertJabToXyz65_default
  },
  ranges: {
    j: [0, 0.222],
    a: [-0.109, 0.129],
    b: [-0.185, 0.134]
  },
  interpolate: {
    j: interpolatorLinear,
    a: interpolatorLinear,
    b: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  }
};
var definition_default11 = definition11;

// node_modules/culori/src/jch/convertJabToJch.js
var convertJabToJch = ({ j: j2, a, b, alpha }) => {
  if (a === void 0) a = 0;
  if (b === void 0) b = 0;
  let c2 = Math.sqrt(a * a + b * b);
  let res = {
    mode: "jch",
    j: j2,
    c: c2
  };
  if (c2) {
    res.h = normalizeHue_default(Math.atan2(b, a) * 180 / Math.PI);
  }
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertJabToJch_default = convertJabToJch;

// node_modules/culori/src/jch/convertJchToJab.js
var convertJchToJab = ({ j: j2, c: c2, h, alpha }) => {
  if (h === void 0) h = 0;
  let res = {
    mode: "jab",
    j: j2,
    a: c2 ? c2 * Math.cos(h / 180 * Math.PI) : 0,
    b: c2 ? c2 * Math.sin(h / 180 * Math.PI) : 0
  };
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertJchToJab_default = convertJchToJab;

// node_modules/culori/src/jch/definition.js
var definition12 = {
  mode: "jch",
  parse: ["--jzczhz"],
  serialize: "--jzczhz",
  toMode: {
    jab: convertJchToJab_default,
    rgb: (c2) => convertJabToRgb_default(convertJchToJab_default(c2))
  },
  fromMode: {
    rgb: (c2) => convertJabToJch_default(convertRgbToJab_default(c2)),
    jab: convertJabToJch_default
  },
  channels: ["j", "c", "h", "alpha"],
  ranges: {
    j: [0, 0.221],
    c: [0, 0.19],
    h: [0, 360]
  },
  interpolate: {
    h: { use: interpolatorLinear, fixup: fixupHueShorter },
    c: interpolatorLinear,
    j: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  },
  difference: {
    h: differenceHueChroma
  },
  average: {
    h: averageAngle
  }
};
var definition_default12 = definition12;

// node_modules/culori/src/xyz50/constants.js
var k3 = Math.pow(29, 3) / Math.pow(3, 3);
var e3 = Math.pow(6, 3) / Math.pow(29, 3);

// node_modules/culori/src/lab/convertLabToXyz50.js
var fn4 = (v) => Math.pow(v, 3) > e3 ? Math.pow(v, 3) : (116 * v - 16) / k3;
var convertLabToXyz50 = ({ l, a, b, alpha }) => {
  if (l === void 0) l = 0;
  if (a === void 0) a = 0;
  if (b === void 0) b = 0;
  let fy = (l + 16) / 116;
  let fx = a / 500 + fy;
  let fz = fy - b / 200;
  let res = {
    mode: "xyz50",
    x: fn4(fx) * D50.X,
    y: fn4(fy) * D50.Y,
    z: fn4(fz) * D50.Z
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertLabToXyz50_default = convertLabToXyz50;

// node_modules/culori/src/xyz50/convertXyz50ToRgb.js
var convertXyz50ToRgb = ({ x, y, z, alpha }) => {
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (z === void 0) z = 0;
  let res = convertLrgbToRgb_default({
    r: x * 3.1341359569958707 - y * 1.6173863321612538 - 0.4906619460083532 * z,
    g: x * -0.978795502912089 + y * 1.916254567259524 + 0.03344273116131949 * z,
    b: x * 0.07195537988411677 - y * 0.2289768264158322 + 1.405386058324125 * z
  });
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz50ToRgb_default = convertXyz50ToRgb;

// node_modules/culori/src/lab/convertLabToRgb.js
var convertLabToRgb = (lab2) => convertXyz50ToRgb_default(convertLabToXyz50_default(lab2));
var convertLabToRgb_default = convertLabToRgb;

// node_modules/culori/src/xyz50/convertRgbToXyz50.js
var convertRgbToXyz50 = (rgb2) => {
  let { r, g, b, alpha } = convertRgbToLrgb_default(rgb2);
  let res = {
    mode: "xyz50",
    x: 0.436065742824811 * r + 0.3851514688337912 * g + 0.14307845442264197 * b,
    y: 0.22249319175623702 * r + 0.7168870538238823 * g + 0.06061979053616537 * b,
    z: 0.013923904500943465 * r + 0.09708128566574634 * g + 0.7140993584005155 * b
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertRgbToXyz50_default = convertRgbToXyz50;

// node_modules/culori/src/lab/convertXyz50ToLab.js
var f2 = (value) => value > e3 ? Math.cbrt(value) : (k3 * value + 16) / 116;
var convertXyz50ToLab = ({ x, y, z, alpha }) => {
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (z === void 0) z = 0;
  let f0 = f2(x / D50.X);
  let f1 = f2(y / D50.Y);
  let f22 = f2(z / D50.Z);
  let res = {
    mode: "lab",
    l: 116 * f1 - 16,
    a: 500 * (f0 - f1),
    b: 200 * (f1 - f22)
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz50ToLab_default = convertXyz50ToLab;

// node_modules/culori/src/lab/convertRgbToLab.js
var convertRgbToLab = (rgb2) => {
  let res = convertXyz50ToLab_default(convertRgbToXyz50_default(rgb2));
  if (rgb2.r === rgb2.b && rgb2.b === rgb2.g) {
    res.a = res.b = 0;
  }
  return res;
};
var convertRgbToLab_default = convertRgbToLab;

// node_modules/culori/src/lab/parseLab.js
function parseLab(color, parsed) {
  if (!parsed || parsed[0] !== "lab") {
    return void 0;
  }
  const res = { mode: "lab" };
  const [, l, a, b, alpha] = parsed;
  if (l.type === Tok.Hue || a.type === Tok.Hue || b.type === Tok.Hue) {
    return void 0;
  }
  if (l.type !== Tok.None) {
    res.l = Math.min(Math.max(0, l.value), 100);
  }
  if (a.type !== Tok.None) {
    res.a = a.type === Tok.Number ? a.value : a.value * 125 / 100;
  }
  if (b.type !== Tok.None) {
    res.b = b.type === Tok.Number ? b.value : b.value * 125 / 100;
  }
  if (alpha.type !== Tok.None) {
    res.alpha = Math.min(
      1,
      Math.max(
        0,
        alpha.type === Tok.Number ? alpha.value : alpha.value / 100
      )
    );
  }
  return res;
}
var parseLab_default = parseLab;

// node_modules/culori/src/lab/definition.js
var definition13 = {
  mode: "lab",
  toMode: {
    xyz50: convertLabToXyz50_default,
    rgb: convertLabToRgb_default
  },
  fromMode: {
    xyz50: convertXyz50ToLab_default,
    rgb: convertRgbToLab_default
  },
  channels: ["l", "a", "b", "alpha"],
  ranges: {
    l: [0, 100],
    a: [-125, 125],
    b: [-125, 125]
  },
  parse: [parseLab_default],
  serialize: (c2) => `lab(${c2.l !== void 0 ? c2.l : "none"} ${c2.a !== void 0 ? c2.a : "none"} ${c2.b !== void 0 ? c2.b : "none"}${c2.alpha < 1 ? ` / ${c2.alpha}` : ""})`,
  interpolate: {
    l: interpolatorLinear,
    a: interpolatorLinear,
    b: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  }
};
var definition_default13 = definition13;

// node_modules/culori/src/lab65/definition.js
var definition14 = {
  ...definition_default13,
  mode: "lab65",
  parse: ["--lab-d65"],
  serialize: "--lab-d65",
  toMode: {
    xyz65: convertLab65ToXyz65_default,
    rgb: convertLab65ToRgb_default
  },
  fromMode: {
    xyz65: convertXyz65ToLab65_default,
    rgb: convertRgbToLab65_default
  },
  ranges: {
    l: [0, 100],
    a: [-125, 125],
    b: [-125, 125]
  }
};
var definition_default14 = definition14;

// node_modules/culori/src/lch/parseLch.js
function parseLch(color, parsed) {
  if (!parsed || parsed[0] !== "lch") {
    return void 0;
  }
  const res = { mode: "lch" };
  const [, l, c2, h, alpha] = parsed;
  if (l.type !== Tok.None) {
    if (l.type === Tok.Hue) {
      return void 0;
    }
    res.l = Math.min(Math.max(0, l.value), 100);
  }
  if (c2.type !== Tok.None) {
    res.c = Math.max(
      0,
      c2.type === Tok.Number ? c2.value : c2.value * 150 / 100
    );
  }
  if (h.type !== Tok.None) {
    if (h.type === Tok.Percentage) {
      return void 0;
    }
    res.h = h.value;
  }
  if (alpha.type !== Tok.None) {
    res.alpha = Math.min(
      1,
      Math.max(
        0,
        alpha.type === Tok.Number ? alpha.value : alpha.value / 100
      )
    );
  }
  return res;
}
var parseLch_default = parseLch;

// node_modules/culori/src/lch/definition.js
var definition15 = {
  mode: "lch",
  toMode: {
    lab: convertLchToLab_default,
    rgb: (c2) => convertLabToRgb_default(convertLchToLab_default(c2))
  },
  fromMode: {
    rgb: (c2) => convertLabToLch_default(convertRgbToLab_default(c2)),
    lab: convertLabToLch_default
  },
  channels: ["l", "c", "h", "alpha"],
  ranges: {
    l: [0, 100],
    c: [0, 150],
    h: [0, 360]
  },
  parse: [parseLch_default],
  serialize: (c2) => `lch(${c2.l !== void 0 ? c2.l : "none"} ${c2.c !== void 0 ? c2.c : "none"} ${c2.h !== void 0 ? c2.h : "none"}${c2.alpha < 1 ? ` / ${c2.alpha}` : ""})`,
  interpolate: {
    h: { use: interpolatorLinear, fixup: fixupHueShorter },
    c: interpolatorLinear,
    l: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  },
  difference: {
    h: differenceHueChroma
  },
  average: {
    h: averageAngle
  }
};
var definition_default15 = definition15;

// node_modules/culori/src/lch65/definition.js
var definition16 = {
  ...definition_default15,
  mode: "lch65",
  parse: ["--lch-d65"],
  serialize: "--lch-d65",
  toMode: {
    lab65: (c2) => convertLchToLab_default(c2, "lab65"),
    rgb: (c2) => convertLab65ToRgb_default(convertLchToLab_default(c2, "lab65"))
  },
  fromMode: {
    rgb: (c2) => convertLabToLch_default(convertRgbToLab65_default(c2), "lch65"),
    lab65: (c2) => convertLabToLch_default(c2, "lch65")
  },
  ranges: {
    l: [0, 100],
    c: [0, 150],
    h: [0, 360]
  }
};
var definition_default16 = definition16;

// node_modules/culori/src/lchuv/convertLuvToLchuv.js
var convertLuvToLchuv = ({ l, u, v, alpha }) => {
  if (u === void 0) u = 0;
  if (v === void 0) v = 0;
  let c2 = Math.sqrt(u * u + v * v);
  let res = {
    mode: "lchuv",
    l,
    c: c2
  };
  if (c2) {
    res.h = normalizeHue_default(Math.atan2(v, u) * 180 / Math.PI);
  }
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertLuvToLchuv_default = convertLuvToLchuv;

// node_modules/culori/src/lchuv/convertLchuvToLuv.js
var convertLchuvToLuv = ({ l, c: c2, h, alpha }) => {
  if (h === void 0) h = 0;
  let res = {
    mode: "luv",
    l,
    u: c2 ? c2 * Math.cos(h / 180 * Math.PI) : 0,
    v: c2 ? c2 * Math.sin(h / 180 * Math.PI) : 0
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertLchuvToLuv_default = convertLchuvToLuv;

// node_modules/culori/src/luv/convertXyz50ToLuv.js
var u_fn = (x, y, z) => 4 * x / (x + 15 * y + 3 * z);
var v_fn = (x, y, z) => 9 * y / (x + 15 * y + 3 * z);
var un = u_fn(D50.X, D50.Y, D50.Z);
var vn = v_fn(D50.X, D50.Y, D50.Z);
var l_fn = (value) => value <= e3 ? k3 * value : 116 * Math.cbrt(value) - 16;
var convertXyz50ToLuv = ({ x, y, z, alpha }) => {
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (z === void 0) z = 0;
  let l = l_fn(y / D50.Y);
  let u = u_fn(x, y, z);
  let v = v_fn(x, y, z);
  if (!isFinite(u) || !isFinite(v)) {
    l = u = v = 0;
  } else {
    u = 13 * l * (u - un);
    v = 13 * l * (v - vn);
  }
  let res = {
    mode: "luv",
    l,
    u,
    v
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz50ToLuv_default = convertXyz50ToLuv;

// node_modules/culori/src/luv/convertLuvToXyz50.js
var u_fn2 = (x, y, z) => 4 * x / (x + 15 * y + 3 * z);
var v_fn2 = (x, y, z) => 9 * y / (x + 15 * y + 3 * z);
var un2 = u_fn2(D50.X, D50.Y, D50.Z);
var vn2 = v_fn2(D50.X, D50.Y, D50.Z);
var convertLuvToXyz50 = ({ l, u, v, alpha }) => {
  if (l === void 0) l = 0;
  if (l === 0) {
    return { mode: "xyz50", x: 0, y: 0, z: 0 };
  }
  if (u === void 0) u = 0;
  if (v === void 0) v = 0;
  let up = u / (13 * l) + un2;
  let vp = v / (13 * l) + vn2;
  let y = D50.Y * (l <= 8 ? l / k3 : Math.pow((l + 16) / 116, 3));
  let x = y * (9 * up) / (4 * vp);
  let z = y * (12 - 3 * up - 20 * vp) / (4 * vp);
  let res = { mode: "xyz50", x, y, z };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertLuvToXyz50_default = convertLuvToXyz50;

// node_modules/culori/src/lchuv/definition.js
var convertRgbToLchuv = (rgb2) => convertLuvToLchuv_default(convertXyz50ToLuv_default(convertRgbToXyz50_default(rgb2)));
var convertLchuvToRgb = (lchuv2) => convertXyz50ToRgb_default(convertLuvToXyz50_default(convertLchuvToLuv_default(lchuv2)));
var definition17 = {
  mode: "lchuv",
  toMode: {
    luv: convertLchuvToLuv_default,
    rgb: convertLchuvToRgb
  },
  fromMode: {
    rgb: convertRgbToLchuv,
    luv: convertLuvToLchuv_default
  },
  channels: ["l", "c", "h", "alpha"],
  parse: ["--lchuv"],
  serialize: "--lchuv",
  ranges: {
    l: [0, 100],
    c: [0, 176.956],
    h: [0, 360]
  },
  interpolate: {
    h: { use: interpolatorLinear, fixup: fixupHueShorter },
    c: interpolatorLinear,
    l: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  },
  difference: {
    h: differenceHueChroma
  },
  average: {
    h: averageAngle
  }
};
var definition_default17 = definition17;

// node_modules/culori/src/lrgb/definition.js
var definition18 = {
  ...definition_default,
  mode: "lrgb",
  toMode: {
    rgb: convertLrgbToRgb_default
  },
  fromMode: {
    rgb: convertRgbToLrgb_default
  },
  parse: ["srgb-linear"],
  serialize: "srgb-linear"
};
var definition_default18 = definition18;

// node_modules/culori/src/luv/definition.js
var definition19 = {
  mode: "luv",
  toMode: {
    xyz50: convertLuvToXyz50_default,
    rgb: (luv2) => convertXyz50ToRgb_default(convertLuvToXyz50_default(luv2))
  },
  fromMode: {
    xyz50: convertXyz50ToLuv_default,
    rgb: (rgb2) => convertXyz50ToLuv_default(convertRgbToXyz50_default(rgb2))
  },
  channels: ["l", "u", "v", "alpha"],
  parse: ["--luv"],
  serialize: "--luv",
  ranges: {
    l: [0, 100],
    u: [-84.936, 175.042],
    v: [-125.882, 87.243]
  },
  interpolate: {
    l: interpolatorLinear,
    u: interpolatorLinear,
    v: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  }
};
var definition_default19 = definition19;

// node_modules/culori/src/oklab/convertLrgbToOklab.js
var convertLrgbToOklab = ({ r, g, b, alpha }) => {
  if (r === void 0) r = 0;
  if (g === void 0) g = 0;
  if (b === void 0) b = 0;
  let L = Math.cbrt(
    0.412221469470763 * r + 0.5363325372617348 * g + 0.0514459932675022 * b
  );
  let M3 = Math.cbrt(
    0.2119034958178252 * r + 0.6806995506452344 * g + 0.1073969535369406 * b
  );
  let S = Math.cbrt(
    0.0883024591900564 * r + 0.2817188391361215 * g + 0.6299787016738222 * b
  );
  let res = {
    mode: "oklab",
    l: 0.210454268309314 * L + 0.7936177747023054 * M3 - 0.0040720430116193 * S,
    a: 1.9779985324311684 * L - 2.42859224204858 * M3 + 0.450593709617411 * S,
    b: 0.0259040424655478 * L + 0.7827717124575296 * M3 - 0.8086757549230774 * S
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertLrgbToOklab_default = convertLrgbToOklab;

// node_modules/culori/src/oklab/convertRgbToOklab.js
var convertRgbToOklab = (rgb2) => {
  let res = convertLrgbToOklab_default(convertRgbToLrgb_default(rgb2));
  if (rgb2.r === rgb2.b && rgb2.b === rgb2.g) {
    res.a = res.b = 0;
  }
  return res;
};
var convertRgbToOklab_default = convertRgbToOklab;

// node_modules/culori/src/oklab/convertOklabToLrgb.js
var convertOklabToLrgb = ({ l, a, b, alpha }) => {
  if (l === void 0) l = 0;
  if (a === void 0) a = 0;
  if (b === void 0) b = 0;
  let L = Math.pow(l + 0.3963377773761749 * a + 0.2158037573099136 * b, 3);
  let M3 = Math.pow(l - 0.1055613458156586 * a - 0.0638541728258133 * b, 3);
  let S = Math.pow(l - 0.0894841775298119 * a - 1.2914855480194092 * b, 3);
  let res = {
    mode: "lrgb",
    r: 4.076741636075957 * L - 3.3077115392580616 * M3 + 0.2309699031821044 * S,
    g: -1.2684379732850317 * L + 2.6097573492876887 * M3 - 0.3413193760026573 * S,
    b: -0.0041960761386756 * L - 0.7034186179359362 * M3 + 1.7076146940746117 * S
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertOklabToLrgb_default = convertOklabToLrgb;

// node_modules/culori/src/oklab/convertOklabToRgb.js
var convertOklabToRgb = (c2) => convertLrgbToRgb_default(convertOklabToLrgb_default(c2));
var convertOklabToRgb_default = convertOklabToRgb;

// node_modules/culori/src/okhsl/helpers.js
function toe(x) {
  const k_1 = 0.206;
  const k_2 = 0.03;
  const k_3 = (1 + k_1) / (1 + k_2);
  return 0.5 * (k_3 * x - k_1 + Math.sqrt((k_3 * x - k_1) * (k_3 * x - k_1) + 4 * k_2 * k_3 * x));
}
function toe_inv(x) {
  const k_1 = 0.206;
  const k_2 = 0.03;
  const k_3 = (1 + k_1) / (1 + k_2);
  return (x * x + k_1 * x) / (k_3 * (x + k_2));
}
function compute_max_saturation(a, b) {
  let k0, k1, k22, k32, k42, wl2, wm, ws2;
  if (-1.88170328 * a - 0.80936493 * b > 1) {
    k0 = 1.19086277;
    k1 = 1.76576728;
    k22 = 0.59662641;
    k32 = 0.75515197;
    k42 = 0.56771245;
    wl2 = 4.0767416621;
    wm = -3.3077115913;
    ws2 = 0.2309699292;
  } else if (1.81444104 * a - 1.19445276 * b > 1) {
    k0 = 0.73956515;
    k1 = -0.45954404;
    k22 = 0.08285427;
    k32 = 0.1254107;
    k42 = 0.14503204;
    wl2 = -1.2684380046;
    wm = 2.6097574011;
    ws2 = -0.3413193965;
  } else {
    k0 = 1.35733652;
    k1 = -915799e-8;
    k22 = -1.1513021;
    k32 = -0.50559606;
    k42 = 692167e-8;
    wl2 = -0.0041960863;
    wm = -0.7034186147;
    ws2 = 1.707614701;
  }
  let S = k0 + k1 * a + k22 * b + k32 * a * a + k42 * a * b;
  let k_l = 0.3963377774 * a + 0.2158037573 * b;
  let k_m = -0.1055613458 * a - 0.0638541728 * b;
  let k_s = -0.0894841775 * a - 1.291485548 * b;
  {
    let l_ = 1 + S * k_l;
    let m_ = 1 + S * k_m;
    let s_ = 1 + S * k_s;
    let l = l_ * l_ * l_;
    let m = m_ * m_ * m_;
    let s = s_ * s_ * s_;
    let l_dS = 3 * k_l * l_ * l_;
    let m_dS = 3 * k_m * m_ * m_;
    let s_dS = 3 * k_s * s_ * s_;
    let l_dS2 = 6 * k_l * k_l * l_;
    let m_dS2 = 6 * k_m * k_m * m_;
    let s_dS2 = 6 * k_s * k_s * s_;
    let f3 = wl2 * l + wm * m + ws2 * s;
    let f1 = wl2 * l_dS + wm * m_dS + ws2 * s_dS;
    let f22 = wl2 * l_dS2 + wm * m_dS2 + ws2 * s_dS2;
    S = S - f3 * f1 / (f1 * f1 - 0.5 * f3 * f22);
  }
  return S;
}
function find_cusp(a, b) {
  let S_cusp = compute_max_saturation(a, b);
  let rgb2 = convertOklabToLrgb_default({ l: 1, a: S_cusp * a, b: S_cusp * b });
  let L_cusp = Math.cbrt(1 / Math.max(rgb2.r, rgb2.g, rgb2.b));
  let C_cusp = L_cusp * S_cusp;
  return [L_cusp, C_cusp];
}
function find_gamut_intersection(a, b, L1, C12, L0, cusp = null) {
  if (!cusp) {
    cusp = find_cusp(a, b);
  }
  let t;
  if ((L1 - L0) * cusp[1] - (cusp[0] - L0) * C12 <= 0) {
    t = cusp[1] * L0 / (C12 * cusp[0] + cusp[1] * (L0 - L1));
  } else {
    t = cusp[1] * (L0 - 1) / (C12 * (cusp[0] - 1) + cusp[1] * (L0 - L1));
    {
      let dL = L1 - L0;
      let dC = C12;
      let k_l = 0.3963377774 * a + 0.2158037573 * b;
      let k_m = -0.1055613458 * a - 0.0638541728 * b;
      let k_s = -0.0894841775 * a - 1.291485548 * b;
      let l_dt = dL + dC * k_l;
      let m_dt = dL + dC * k_m;
      let s_dt = dL + dC * k_s;
      {
        let L = L0 * (1 - t) + t * L1;
        let C = t * C12;
        let l_ = L + C * k_l;
        let m_ = L + C * k_m;
        let s_ = L + C * k_s;
        let l = l_ * l_ * l_;
        let m = m_ * m_ * m_;
        let s = s_ * s_ * s_;
        let ldt = 3 * l_dt * l_ * l_;
        let mdt = 3 * m_dt * m_ * m_;
        let sdt = 3 * s_dt * s_ * s_;
        let ldt2 = 6 * l_dt * l_dt * l_;
        let mdt2 = 6 * m_dt * m_dt * m_;
        let sdt2 = 6 * s_dt * s_dt * s_;
        let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s - 1;
        let r1 = 4.0767416621 * ldt - 3.3077115913 * mdt + 0.2309699292 * sdt;
        let r2 = 4.0767416621 * ldt2 - 3.3077115913 * mdt2 + 0.2309699292 * sdt2;
        let u_r = r1 / (r1 * r1 - 0.5 * r * r2);
        let t_r = -r * u_r;
        let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s - 1;
        let g1 = -1.2684380046 * ldt + 2.6097574011 * mdt - 0.3413193965 * sdt;
        let g2 = -1.2684380046 * ldt2 + 2.6097574011 * mdt2 - 0.3413193965 * sdt2;
        let u_g = g1 / (g1 * g1 - 0.5 * g * g2);
        let t_g = -g * u_g;
        let b2 = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s - 1;
        let b1 = -0.0041960863 * ldt - 0.7034186147 * mdt + 1.707614701 * sdt;
        let b22 = -0.0041960863 * ldt2 - 0.7034186147 * mdt2 + 1.707614701 * sdt2;
        let u_b = b1 / (b1 * b1 - 0.5 * b2 * b22);
        let t_b = -b2 * u_b;
        t_r = u_r >= 0 ? t_r : 1e6;
        t_g = u_g >= 0 ? t_g : 1e6;
        t_b = u_b >= 0 ? t_b : 1e6;
        t += Math.min(t_r, Math.min(t_g, t_b));
      }
    }
  }
  return t;
}
function get_ST_max(a_, b_, cusp = null) {
  if (!cusp) {
    cusp = find_cusp(a_, b_);
  }
  let L = cusp[0];
  let C = cusp[1];
  return [C / L, C / (1 - L)];
}
function get_Cs(L, a_, b_) {
  let cusp = find_cusp(a_, b_);
  let C_max = find_gamut_intersection(a_, b_, L, 1, L, cusp);
  let ST_max = get_ST_max(a_, b_, cusp);
  let S_mid = 0.11516993 + 1 / (7.4477897 + 4.1590124 * b_ + a_ * (-2.19557347 + 1.75198401 * b_ + a_ * (-2.13704948 - 10.02301043 * b_ + a_ * (-4.24894561 + 5.38770819 * b_ + 4.69891013 * a_))));
  let T_mid = 0.11239642 + 1 / (1.6132032 - 0.68124379 * b_ + a_ * (0.40370612 + 0.90148123 * b_ + a_ * (-0.27087943 + 0.6122399 * b_ + a_ * (299215e-8 - 0.45399568 * b_ - 0.14661872 * a_))));
  let k5 = C_max / Math.min(L * ST_max[0], (1 - L) * ST_max[1]);
  let C_a = L * S_mid;
  let C_b = (1 - L) * T_mid;
  let C_mid = 0.9 * k5 * Math.sqrt(
    Math.sqrt(
      1 / (1 / (C_a * C_a * C_a * C_a) + 1 / (C_b * C_b * C_b * C_b))
    )
  );
  C_a = L * 0.4;
  C_b = (1 - L) * 0.8;
  let C_0 = Math.sqrt(1 / (1 / (C_a * C_a) + 1 / (C_b * C_b)));
  return [C_0, C_mid, C_max];
}

// node_modules/culori/src/okhsl/convertOklabToOkhsl.js
function convertOklabToOkhsl(lab2) {
  const l = lab2.l !== void 0 ? lab2.l : 0;
  const a = lab2.a !== void 0 ? lab2.a : 0;
  const b = lab2.b !== void 0 ? lab2.b : 0;
  const ret = { mode: "okhsl", l: toe(l) };
  if (lab2.alpha !== void 0) {
    ret.alpha = lab2.alpha;
  }
  let c2 = Math.sqrt(a * a + b * b);
  if (!c2) {
    ret.s = 0;
    return ret;
  }
  let [C_0, C_mid, C_max] = get_Cs(l, a / c2, b / c2);
  let s;
  if (c2 < C_mid) {
    let k_0 = 0;
    let k_1 = 0.8 * C_0;
    let k_2 = 1 - k_1 / C_mid;
    let t = (c2 - k_0) / (k_1 + k_2 * (c2 - k_0));
    s = t * 0.8;
  } else {
    let k_0 = C_mid;
    let k_1 = 0.2 * C_mid * C_mid * 1.25 * 1.25 / C_0;
    let k_2 = 1 - k_1 / (C_max - C_mid);
    let t = (c2 - k_0) / (k_1 + k_2 * (c2 - k_0));
    s = 0.8 + 0.2 * t;
  }
  if (s) {
    ret.s = s;
    ret.h = normalizeHue_default(Math.atan2(b, a) * 180 / Math.PI);
  }
  return ret;
}

// node_modules/culori/src/okhsl/convertOkhslToOklab.js
function convertOkhslToOklab(hsl2) {
  let h = hsl2.h !== void 0 ? hsl2.h : 0;
  let s = hsl2.s !== void 0 ? hsl2.s : 0;
  let l = hsl2.l !== void 0 ? hsl2.l : 0;
  const ret = { mode: "oklab", l: toe_inv(l) };
  if (hsl2.alpha !== void 0) {
    ret.alpha = hsl2.alpha;
  }
  if (!s || l === 1) {
    ret.a = ret.b = 0;
    return ret;
  }
  let a_ = Math.cos(h / 180 * Math.PI);
  let b_ = Math.sin(h / 180 * Math.PI);
  let [C_0, C_mid, C_max] = get_Cs(ret.l, a_, b_);
  let t, k_0, k_1, k_2;
  if (s < 0.8) {
    t = 1.25 * s;
    k_0 = 0;
    k_1 = 0.8 * C_0;
    k_2 = 1 - k_1 / C_mid;
  } else {
    t = 5 * (s - 0.8);
    k_0 = C_mid;
    k_1 = 0.2 * C_mid * C_mid * 1.25 * 1.25 / C_0;
    k_2 = 1 - k_1 / (C_max - C_mid);
  }
  let C = k_0 + t * k_1 / (1 - k_2 * t);
  ret.a = C * a_;
  ret.b = C * b_;
  return ret;
}

// node_modules/culori/src/okhsl/modeOkhsl.js
var modeOkhsl = {
  ...definition_default7,
  mode: "okhsl",
  channels: ["h", "s", "l", "alpha"],
  parse: ["--okhsl"],
  serialize: "--okhsl",
  fromMode: {
    oklab: convertOklabToOkhsl,
    rgb: (c2) => convertOklabToOkhsl(convertRgbToOklab_default(c2))
  },
  toMode: {
    oklab: convertOkhslToOklab,
    rgb: (c2) => convertOklabToRgb_default(convertOkhslToOklab(c2))
  }
};
var modeOkhsl_default = modeOkhsl;

// node_modules/culori/src/okhsv/convertOklabToOkhsv.js
function convertOklabToOkhsv(lab2) {
  let l = lab2.l !== void 0 ? lab2.l : 0;
  let a = lab2.a !== void 0 ? lab2.a : 0;
  let b = lab2.b !== void 0 ? lab2.b : 0;
  let c2 = Math.sqrt(a * a + b * b);
  let a_ = c2 ? a / c2 : 1;
  let b_ = c2 ? b / c2 : 1;
  let [S_max, T] = get_ST_max(a_, b_);
  let S_0 = 0.5;
  let k5 = 1 - S_0 / S_max;
  let t = T / (c2 + l * T);
  let L_v = t * l;
  let C_v = t * c2;
  let L_vt = toe_inv(L_v);
  let C_vt = C_v * L_vt / L_v;
  let rgb_scale = convertOklabToLrgb_default({ l: L_vt, a: a_ * C_vt, b: b_ * C_vt });
  let scale_L = Math.cbrt(
    1 / Math.max(rgb_scale.r, rgb_scale.g, rgb_scale.b, 0)
  );
  l = l / scale_L;
  c2 = c2 / scale_L * toe(l) / l;
  l = toe(l);
  const ret = {
    mode: "okhsv",
    s: c2 ? (S_0 + T) * C_v / (T * S_0 + T * k5 * C_v) : 0,
    v: l ? l / L_v : 0
  };
  if (ret.s) {
    ret.h = normalizeHue_default(Math.atan2(b, a) * 180 / Math.PI);
  }
  if (lab2.alpha !== void 0) {
    ret.alpha = lab2.alpha;
  }
  return ret;
}

// node_modules/culori/src/okhsv/convertOkhsvToOklab.js
function convertOkhsvToOklab(hsv2) {
  const ret = { mode: "oklab" };
  if (hsv2.alpha !== void 0) {
    ret.alpha = hsv2.alpha;
  }
  const h = hsv2.h !== void 0 ? hsv2.h : 0;
  const s = hsv2.s !== void 0 ? hsv2.s : 0;
  const v = hsv2.v !== void 0 ? hsv2.v : 0;
  const a_ = Math.cos(h / 180 * Math.PI);
  const b_ = Math.sin(h / 180 * Math.PI);
  const [S_max, T] = get_ST_max(a_, b_);
  const S_0 = 0.5;
  const k5 = 1 - S_0 / S_max;
  const L_v = 1 - s * S_0 / (S_0 + T - T * k5 * s);
  const C_v = s * T * S_0 / (S_0 + T - T * k5 * s);
  const L_vt = toe_inv(L_v);
  const C_vt = C_v * L_vt / L_v;
  const rgb_scale = convertOklabToLrgb_default({
    l: L_vt,
    a: a_ * C_vt,
    b: b_ * C_vt
  });
  const scale_L = Math.cbrt(
    1 / Math.max(rgb_scale.r, rgb_scale.g, rgb_scale.b, 0)
  );
  const L_new = toe_inv(v * L_v);
  const C = C_v * L_new / L_v;
  ret.l = L_new * scale_L;
  ret.a = C * a_ * scale_L;
  ret.b = C * b_ * scale_L;
  return ret;
}

// node_modules/culori/src/okhsv/modeOkhsv.js
var modeOkhsv = {
  ...definition_default8,
  mode: "okhsv",
  channels: ["h", "s", "v", "alpha"],
  parse: ["--okhsv"],
  serialize: "--okhsv",
  fromMode: {
    oklab: convertOklabToOkhsv,
    rgb: (c2) => convertOklabToOkhsv(convertRgbToOklab_default(c2))
  },
  toMode: {
    oklab: convertOkhsvToOklab,
    rgb: (c2) => convertOklabToRgb_default(convertOkhsvToOklab(c2))
  }
};
var modeOkhsv_default = modeOkhsv;

// node_modules/culori/src/oklab/parseOklab.js
function parseOklab(color, parsed) {
  if (!parsed || parsed[0] !== "oklab") {
    return void 0;
  }
  const res = { mode: "oklab" };
  const [, l, a, b, alpha] = parsed;
  if (l.type === Tok.Hue || a.type === Tok.Hue || b.type === Tok.Hue) {
    return void 0;
  }
  if (l.type !== Tok.None) {
    res.l = Math.min(
      Math.max(0, l.type === Tok.Number ? l.value : l.value / 100),
      1
    );
  }
  if (a.type !== Tok.None) {
    res.a = a.type === Tok.Number ? a.value : a.value * 0.4 / 100;
  }
  if (b.type !== Tok.None) {
    res.b = b.type === Tok.Number ? b.value : b.value * 0.4 / 100;
  }
  if (alpha.type !== Tok.None) {
    res.alpha = Math.min(
      1,
      Math.max(
        0,
        alpha.type === Tok.Number ? alpha.value : alpha.value / 100
      )
    );
  }
  return res;
}
var parseOklab_default = parseOklab;

// node_modules/culori/src/oklab/definition.js
var definition20 = {
  ...definition_default13,
  mode: "oklab",
  toMode: {
    lrgb: convertOklabToLrgb_default,
    rgb: convertOklabToRgb_default
  },
  fromMode: {
    lrgb: convertLrgbToOklab_default,
    rgb: convertRgbToOklab_default
  },
  ranges: {
    l: [0, 1],
    a: [-0.4, 0.4],
    b: [-0.4, 0.4]
  },
  parse: [parseOklab_default],
  serialize: (c2) => `oklab(${c2.l !== void 0 ? c2.l : "none"} ${c2.a !== void 0 ? c2.a : "none"} ${c2.b !== void 0 ? c2.b : "none"}${c2.alpha < 1 ? ` / ${c2.alpha}` : ""})`
};
var definition_default20 = definition20;

// node_modules/culori/src/oklch/parseOklch.js
function parseOklch(color, parsed) {
  if (!parsed || parsed[0] !== "oklch") {
    return void 0;
  }
  const res = { mode: "oklch" };
  const [, l, c2, h, alpha] = parsed;
  if (l.type !== Tok.None) {
    if (l.type === Tok.Hue) {
      return void 0;
    }
    res.l = Math.min(
      Math.max(0, l.type === Tok.Number ? l.value : l.value / 100),
      1
    );
  }
  if (c2.type !== Tok.None) {
    res.c = Math.max(
      0,
      c2.type === Tok.Number ? c2.value : c2.value * 0.4 / 100
    );
  }
  if (h.type !== Tok.None) {
    if (h.type === Tok.Percentage) {
      return void 0;
    }
    res.h = h.value;
  }
  if (alpha.type !== Tok.None) {
    res.alpha = Math.min(
      1,
      Math.max(
        0,
        alpha.type === Tok.Number ? alpha.value : alpha.value / 100
      )
    );
  }
  return res;
}
var parseOklch_default = parseOklch;

// node_modules/culori/src/oklch/definition.js
var definition21 = {
  ...definition_default15,
  mode: "oklch",
  toMode: {
    oklab: (c2) => convertLchToLab_default(c2, "oklab"),
    rgb: (c2) => convertOklabToRgb_default(convertLchToLab_default(c2, "oklab"))
  },
  fromMode: {
    rgb: (c2) => convertLabToLch_default(convertRgbToOklab_default(c2), "oklch"),
    oklab: (c2) => convertLabToLch_default(c2, "oklch")
  },
  parse: [parseOklch_default],
  serialize: (c2) => `oklch(${c2.l !== void 0 ? c2.l : "none"} ${c2.c !== void 0 ? c2.c : "none"} ${c2.h !== void 0 ? c2.h : "none"}${c2.alpha < 1 ? ` / ${c2.alpha}` : ""})`,
  ranges: {
    l: [0, 1],
    c: [0, 0.4],
    h: [0, 360]
  }
};
var definition_default21 = definition21;

// node_modules/culori/src/p3/convertP3ToXyz65.js
var convertP3ToXyz65 = (rgb2) => {
  let { r, g, b, alpha } = convertRgbToLrgb_default(rgb2);
  let res = {
    mode: "xyz65",
    x: 0.486570948648216 * r + 0.265667693169093 * g + 0.1982172852343625 * b,
    y: 0.2289745640697487 * r + 0.6917385218365062 * g + 0.079286914093745 * b,
    z: 0 * r + 0.0451133818589026 * g + 1.043944368900976 * b
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertP3ToXyz65_default = convertP3ToXyz65;

// node_modules/culori/src/p3/convertXyz65ToP3.js
var convertXyz65ToP3 = ({ x, y, z, alpha }) => {
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (z === void 0) z = 0;
  let res = convertLrgbToRgb_default(
    {
      r: x * 2.4934969119414263 - y * 0.9313836179191242 - 0.402710784450717 * z,
      g: x * -0.8294889695615749 + y * 1.7626640603183465 + 0.0236246858419436 * z,
      b: x * 0.0358458302437845 - y * 0.0761723892680418 + 0.9568845240076871 * z
    },
    "p3"
  );
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz65ToP3_default = convertXyz65ToP3;

// node_modules/culori/src/p3/definition.js
var definition22 = {
  ...definition_default,
  mode: "p3",
  parse: ["display-p3"],
  serialize: "display-p3",
  fromMode: {
    rgb: (color) => convertXyz65ToP3_default(convertRgbToXyz65_default(color)),
    xyz65: convertXyz65ToP3_default
  },
  toMode: {
    rgb: (color) => convertXyz65ToRgb_default(convertP3ToXyz65_default(color)),
    xyz65: convertP3ToXyz65_default
  }
};
var definition_default22 = definition22;

// node_modules/culori/src/prophoto/convertXyz50ToProphoto.js
var gamma2 = (v) => {
  let abs2 = Math.abs(v);
  if (abs2 >= 1 / 512) {
    return Math.sign(v) * Math.pow(abs2, 1 / 1.8);
  }
  return 16 * v;
};
var convertXyz50ToProphoto = ({ x, y, z, alpha }) => {
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (z === void 0) z = 0;
  let res = {
    mode: "prophoto",
    r: gamma2(
      x * 1.3457868816471585 - y * 0.2555720873797946 - 0.0511018649755453 * z
    ),
    g: gamma2(
      x * -0.5446307051249019 + y * 1.5082477428451466 + 0.0205274474364214 * z
    ),
    b: gamma2(x * 0 + y * 0 + 1.2119675456389452 * z)
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz50ToProphoto_default = convertXyz50ToProphoto;

// node_modules/culori/src/prophoto/convertProphotoToXyz50.js
var linearize2 = (v = 0) => {
  let abs2 = Math.abs(v);
  if (abs2 >= 16 / 512) {
    return Math.sign(v) * Math.pow(abs2, 1.8);
  }
  return v / 16;
};
var convertProphotoToXyz50 = (prophoto2) => {
  let r = linearize2(prophoto2.r);
  let g = linearize2(prophoto2.g);
  let b = linearize2(prophoto2.b);
  let res = {
    mode: "xyz50",
    x: 0.7977666449006423 * r + 0.1351812974005331 * g + 0.0313477341283922 * b,
    y: 0.2880748288194013 * r + 0.7118352342418731 * g + 899369387256e-16 * b,
    z: 0 * r + 0 * g + 0.8251046025104602 * b
  };
  if (prophoto2.alpha !== void 0) {
    res.alpha = prophoto2.alpha;
  }
  return res;
};
var convertProphotoToXyz50_default = convertProphotoToXyz50;

// node_modules/culori/src/prophoto/definition.js
var definition23 = {
  ...definition_default,
  mode: "prophoto",
  parse: ["prophoto-rgb"],
  serialize: "prophoto-rgb",
  fromMode: {
    xyz50: convertXyz50ToProphoto_default,
    rgb: (color) => convertXyz50ToProphoto_default(convertRgbToXyz50_default(color))
  },
  toMode: {
    xyz50: convertProphotoToXyz50_default,
    rgb: (color) => convertXyz50ToRgb_default(convertProphotoToXyz50_default(color))
  }
};
var definition_default23 = definition23;

// node_modules/culori/src/rec2020/convertXyz65ToRec2020.js
var \u03B1 = 1.09929682680944;
var \u03B2 = 0.018053968510807;
var gamma3 = (v) => {
  const abs2 = Math.abs(v);
  if (abs2 > \u03B2) {
    return (Math.sign(v) || 1) * (\u03B1 * Math.pow(abs2, 0.45) - (\u03B1 - 1));
  }
  return 4.5 * v;
};
var convertXyz65ToRec2020 = ({ x, y, z, alpha }) => {
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (z === void 0) z = 0;
  let res = {
    mode: "rec2020",
    r: gamma3(
      x * 1.7166511879712683 - y * 0.3556707837763925 - 0.2533662813736599 * z
    ),
    g: gamma3(
      x * -0.6666843518324893 + y * 1.6164812366349395 + 0.0157685458139111 * z
    ),
    b: gamma3(
      x * 0.0176398574453108 - y * 0.0427706132578085 + 0.9421031212354739 * z
    )
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz65ToRec2020_default = convertXyz65ToRec2020;

// node_modules/culori/src/rec2020/convertRec2020ToXyz65.js
var \u03B12 = 1.09929682680944;
var \u03B22 = 0.018053968510807;
var linearize3 = (v = 0) => {
  let abs2 = Math.abs(v);
  if (abs2 < \u03B22 * 4.5) {
    return v / 4.5;
  }
  return (Math.sign(v) || 1) * Math.pow((abs2 + \u03B12 - 1) / \u03B12, 1 / 0.45);
};
var convertRec2020ToXyz65 = (rec20202) => {
  let r = linearize3(rec20202.r);
  let g = linearize3(rec20202.g);
  let b = linearize3(rec20202.b);
  let res = {
    mode: "xyz65",
    x: 0.6369580483012911 * r + 0.1446169035862083 * g + 0.1688809751641721 * b,
    y: 0.262700212011267 * r + 0.6779980715188708 * g + 0.059301716469862 * b,
    z: 0 * r + 0.0280726930490874 * g + 1.0609850577107909 * b
  };
  if (rec20202.alpha !== void 0) {
    res.alpha = rec20202.alpha;
  }
  return res;
};
var convertRec2020ToXyz65_default = convertRec2020ToXyz65;

// node_modules/culori/src/rec2020/definition.js
var definition24 = {
  ...definition_default,
  mode: "rec2020",
  fromMode: {
    xyz65: convertXyz65ToRec2020_default,
    rgb: (color) => convertXyz65ToRec2020_default(convertRgbToXyz65_default(color))
  },
  toMode: {
    xyz65: convertRec2020ToXyz65_default,
    rgb: (color) => convertXyz65ToRgb_default(convertRec2020ToXyz65_default(color))
  },
  parse: ["rec2020"],
  serialize: "rec2020"
};
var definition_default24 = definition24;

// node_modules/culori/src/xyb/constants.js
var bias = 0.0037930732552754493;
var bias_cbrt = Math.cbrt(bias);

// node_modules/culori/src/xyb/convertRgbToXyb.js
var transfer = (v) => Math.cbrt(v) - bias_cbrt;
var convertRgbToXyb = (color) => {
  const { r, g, b, alpha } = convertRgbToLrgb_default(color);
  const l = transfer(0.3 * r + 0.622 * g + 0.078 * b + bias);
  const m = transfer(0.23 * r + 0.692 * g + 0.078 * b + bias);
  const s = transfer(
    0.2434226892454782 * r + 0.2047674442449682 * g + 0.5518098665095535 * b + bias
  );
  const res = {
    mode: "xyb",
    x: (l - m) / 2,
    y: (l + m) / 2,
    /* Apply default chroma from luma (subtract Y from B) */
    b: s - (l + m) / 2
  };
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertRgbToXyb_default = convertRgbToXyb;

// node_modules/culori/src/xyb/convertXybToRgb.js
var transfer2 = (v) => Math.pow(v + bias_cbrt, 3);
var convertXybToRgb = ({ x, y, b, alpha }) => {
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (b === void 0) b = 0;
  const l = transfer2(x + y) - bias;
  const m = transfer2(y - x) - bias;
  const s = transfer2(b + y) - bias;
  const res = convertLrgbToRgb_default({
    r: 11.031566904639861 * l - 9.866943908131562 * m - 0.16462299650829934 * s,
    g: -3.2541473810744237 * l + 4.418770377582723 * m - 0.16462299650829934 * s,
    b: -3.6588512867136815 * l + 2.7129230459360922 * m + 1.9459282407775895 * s
  });
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertXybToRgb_default = convertXybToRgb;

// node_modules/culori/src/xyb/definition.js
var definition25 = {
  mode: "xyb",
  channels: ["x", "y", "b", "alpha"],
  parse: ["--xyb"],
  serialize: "--xyb",
  toMode: {
    rgb: convertXybToRgb_default
  },
  fromMode: {
    rgb: convertRgbToXyb_default
  },
  ranges: {
    x: [-0.0154, 0.0281],
    y: [0, 0.8453],
    b: [-0.2778, 0.388]
  },
  interpolate: {
    x: interpolatorLinear,
    y: interpolatorLinear,
    b: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  }
};
var definition_default25 = definition25;

// node_modules/culori/src/xyz50/definition.js
var definition26 = {
  mode: "xyz50",
  parse: ["xyz-d50"],
  serialize: "xyz-d50",
  toMode: {
    rgb: convertXyz50ToRgb_default,
    lab: convertXyz50ToLab_default
  },
  fromMode: {
    rgb: convertRgbToXyz50_default,
    lab: convertLabToXyz50_default
  },
  channels: ["x", "y", "z", "alpha"],
  ranges: {
    x: [0, 0.964],
    y: [0, 0.999],
    z: [0, 0.825]
  },
  interpolate: {
    x: interpolatorLinear,
    y: interpolatorLinear,
    z: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  }
};
var definition_default26 = definition26;

// node_modules/culori/src/xyz65/convertXyz65ToXyz50.js
var convertXyz65ToXyz50 = (xyz652) => {
  let { x, y, z, alpha } = xyz652;
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (z === void 0) z = 0;
  let res = {
    mode: "xyz50",
    x: 1.0479298208405488 * x + 0.0229467933410191 * y - 0.0501922295431356 * z,
    y: 0.0296278156881593 * x + 0.990434484573249 * y - 0.0170738250293851 * z,
    z: -0.0092430581525912 * x + 0.0150551448965779 * y + 0.7518742899580008 * z
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz65ToXyz50_default = convertXyz65ToXyz50;

// node_modules/culori/src/xyz65/convertXyz50ToXyz65.js
var convertXyz50ToXyz65 = (xyz502) => {
  let { x, y, z, alpha } = xyz502;
  if (x === void 0) x = 0;
  if (y === void 0) y = 0;
  if (z === void 0) z = 0;
  let res = {
    mode: "xyz65",
    x: 0.9554734527042182 * x - 0.0230985368742614 * y + 0.0632593086610217 * z,
    y: -0.0283697069632081 * x + 1.0099954580058226 * y + 0.021041398966943 * z,
    z: 0.0123140016883199 * x - 0.0205076964334779 * y + 1.3303659366080753 * z
  };
  if (alpha !== void 0) {
    res.alpha = alpha;
  }
  return res;
};
var convertXyz50ToXyz65_default = convertXyz50ToXyz65;

// node_modules/culori/src/xyz65/definition.js
var definition27 = {
  mode: "xyz65",
  toMode: {
    rgb: convertXyz65ToRgb_default,
    xyz50: convertXyz65ToXyz50_default
  },
  fromMode: {
    rgb: convertRgbToXyz65_default,
    xyz50: convertXyz50ToXyz65_default
  },
  ranges: {
    x: [0, 0.95],
    y: [0, 1],
    z: [0, 1.088]
  },
  channels: ["x", "y", "z", "alpha"],
  parse: ["xyz", "xyz-d65"],
  serialize: "xyz-d65",
  interpolate: {
    x: interpolatorLinear,
    y: interpolatorLinear,
    z: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  }
};
var definition_default27 = definition27;

// node_modules/culori/src/yiq/convertRgbToYiq.js
var convertRgbToYiq = ({ r, g, b, alpha }) => {
  if (r === void 0) r = 0;
  if (g === void 0) g = 0;
  if (b === void 0) b = 0;
  const res = {
    mode: "yiq",
    y: 0.29889531 * r + 0.58662247 * g + 0.11448223 * b,
    i: 0.59597799 * r - 0.2741761 * g - 0.32180189 * b,
    q: 0.21147017 * r - 0.52261711 * g + 0.31114694 * b
  };
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertRgbToYiq_default = convertRgbToYiq;

// node_modules/culori/src/yiq/convertYiqToRgb.js
var convertYiqToRgb = ({ y, i, q, alpha }) => {
  if (y === void 0) y = 0;
  if (i === void 0) i = 0;
  if (q === void 0) q = 0;
  const res = {
    mode: "rgb",
    r: y + 0.95608445 * i + 0.6208885 * q,
    g: y - 0.27137664 * i - 0.6486059 * q,
    b: y - 1.10561724 * i + 1.70250126 * q
  };
  if (alpha !== void 0) res.alpha = alpha;
  return res;
};
var convertYiqToRgb_default = convertYiqToRgb;

// node_modules/culori/src/yiq/definition.js
var definition28 = {
  mode: "yiq",
  toMode: {
    rgb: convertYiqToRgb_default
  },
  fromMode: {
    rgb: convertRgbToYiq_default
  },
  channels: ["y", "i", "q", "alpha"],
  parse: ["--yiq"],
  serialize: "--yiq",
  ranges: {
    i: [-0.595, 0.595],
    q: [-0.522, 0.522]
  },
  interpolate: {
    y: interpolatorLinear,
    i: interpolatorLinear,
    q: interpolatorLinear,
    alpha: { use: interpolatorLinear, fixup: fixupAlpha }
  }
};
var definition_default28 = definition28;

// node_modules/culori/src/index.js
var a98 = useMode(definition_default2);
var cubehelix = useMode(definition_default3);
var dlab = useMode(definition_default4);
var dlch = useMode(definition_default5);
var hsi = useMode(definition_default6);
var hsl = useMode(definition_default7);
var hsv = useMode(definition_default8);
var hwb = useMode(definition_default9);
var itp = useMode(definition_default10);
var jab = useMode(definition_default11);
var jch = useMode(definition_default12);
var lab = useMode(definition_default13);
var lab65 = useMode(definition_default14);
var lch = useMode(definition_default15);
var lch65 = useMode(definition_default16);
var lchuv = useMode(definition_default17);
var lrgb = useMode(definition_default18);
var luv = useMode(definition_default19);
var okhsl = useMode(modeOkhsl_default);
var okhsv = useMode(modeOkhsv_default);
var oklab = useMode(definition_default20);
var oklch = useMode(definition_default21);
var p3 = useMode(definition_default22);
var prophoto = useMode(definition_default23);
var rec2020 = useMode(definition_default24);
var rgb = useMode(definition_default);
var xyb = useMode(definition_default25);
var xyz50 = useMode(definition_default26);
var xyz65 = useMode(definition_default27);
var yiq = useMode(definition_default28);

// src/color.ts
var toLabColor = converter_default("lab65");
var dE00 = differenceCiede2000();
function toLab([r, g, b]) {
  const c2 = toLabColor({ mode: "rgb", r: r / 255, g: g / 255, b: b / 255 });
  return { l: c2.l, a: c2.a, b: c2.b };
}
function ciede2000(a, b) {
  return dE00({ mode: "lab65", l: a.l, a: a.a, b: a.b }, { mode: "lab65", l: b.l, a: b.a, b: b.b });
}

// src/types.ts
var FACES = ["U", "R", "F", "D", "L", "B"];

// src/classify.ts
function classify(samples, centers) {
  if (centers.length !== 6) throw new Error(`expected 6 centers, got ${centers.length}`);
  const centerLabs = centers.map(toLab);
  const letters = [];
  const confidence = [];
  for (const sample of samples) {
    const lab2 = toLab(sample);
    let nearest = Number.POSITIVE_INFINITY;
    let second = Number.POSITIVE_INFINITY;
    let nearestIdx = 0;
    for (let k5 = 0; k5 < 6; k5++) {
      const d = ciede2000(lab2, centerLabs[k5]);
      const dist = Number.isFinite(d) ? d : Number.POSITIVE_INFINITY;
      if (dist < nearest) {
        second = nearest;
        nearest = dist;
        nearestIdx = k5;
      } else if (dist < second) {
        second = dist;
      }
    }
    letters.push(FACES[nearestIdx]);
    const raw = second === 0 ? 0 : 1 - nearest / second;
    const conf = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
    confidence.push(conf);
  }
  return { letters, confidence };
}

// src/facelet-cube.ts
var SOLVED = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";
var CORNER_FACELET = [
  [8, 9, 20],
  [6, 18, 38],
  [0, 36, 47],
  [2, 45, 11],
  [29, 26, 15],
  [27, 44, 24],
  [33, 53, 42],
  [35, 17, 51]
];
var EDGE_FACELET = [
  [5, 10],
  [7, 19],
  [3, 37],
  [1, 46],
  [32, 16],
  [28, 25],
  [30, 43],
  [34, 52],
  [23, 12],
  [21, 41],
  [50, 39],
  [48, 14]
];
var CORNER_COLOR = CORNER_FACELET.map((t) => t.map((i) => SOLVED[i]));
var EDGE_COLOR = EDGE_FACELET.map((t) => t.map((i) => SOLVED[i]));
var CENTER_INDEX = {
  U: 4,
  R: 13,
  F: 22,
  D: 31,
  L: 40,
  B: 49
};
function decodeFacelets(f3) {
  if (f3.length !== 54) return null;
  const cp = new Array(8);
  const co2 = new Array(8);
  for (let i = 0; i < 8; i++) {
    const slot = CORNER_FACELET[i];
    let ori = 0;
    for (; ori < 3; ori++) {
      const c3 = f3[slot[ori]];
      if (c3 === "U" || c3 === "D") break;
    }
    if (ori === 3) return null;
    const c0 = f3[slot[ori]];
    const c1 = f3[slot[(ori + 1) % 3]];
    const c2 = f3[slot[(ori + 2) % 3]];
    let found = -1;
    for (let j2 = 0; j2 < 8; j2++) {
      const cc2 = CORNER_COLOR[j2];
      if (c0 === cc2[0] && c1 === cc2[1] && c2 === cc2[2]) {
        found = j2;
        break;
      }
    }
    if (found < 0) return null;
    cp[i] = found;
    co2[i] = ori;
  }
  const ep2 = new Array(12);
  const eo2 = new Array(12);
  for (let i = 0; i < 12; i++) {
    const slot = EDGE_FACELET[i];
    const a = f3[slot[0]];
    const b = f3[slot[1]];
    let found = -1;
    let ori = 0;
    for (let j2 = 0; j2 < 12; j2++) {
      const ec2 = EDGE_COLOR[j2];
      if (a === ec2[0] && b === ec2[1]) {
        found = j2;
        ori = 0;
        break;
      }
      if (a === ec2[1] && b === ec2[0]) {
        found = j2;
        ori = 1;
        break;
      }
    }
    if (found < 0) return null;
    ep2[i] = found;
    eo2[i] = ori;
  }
  return { cp, co: co2, ep: ep2, eo: eo2 };
}
function isPermutation(a, n) {
  if (a.length !== n) return false;
  const seen = new Array(n).fill(false);
  for (const v of a) {
    if (!Number.isInteger(v) || v < 0 || v >= n || seen[v]) return false;
    seen[v] = true;
  }
  return true;
}
function inDomain(a, n, max) {
  if (a.length !== n) return false;
  for (const v of a) {
    if (!Number.isInteger(v) || v < 0 || v > max) return false;
  }
  return true;
}
function parity(a) {
  let inversions = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j2 = i + 1; j2 < a.length; j2++) {
      if (a[i] > a[j2]) inversions++;
    }
  }
  return inversions & 1;
}
function isSolvable(s) {
  if (!isPermutation(s.cp, 8) || !isPermutation(s.ep, 12)) return false;
  if (!inDomain(s.co, 8, 2) || !inDomain(s.eo, 12, 1)) return false;
  const coSum = s.co.reduce((sum, v) => sum + v, 0);
  const eoSum = s.eo.reduce((sum, v) => sum + v, 0);
  if (coSum % 3 !== 0) return false;
  if (eoSum % 2 !== 0) return false;
  return parity(s.cp) === parity(s.ep);
}
function centersOk(f3) {
  return f3.length === 54 && f3[CENTER_INDEX.U] === "U" && f3[CENTER_INDEX.R] === "R" && f3[CENTER_INDEX.F] === "F" && f3[CENTER_INDEX.D] === "D" && f3[CENTER_INDEX.L] === "L" && f3[CENTER_INDEX.B] === "B";
}
function isStructurallyValid(f3) {
  if (!centersOk(f3)) return false;
  const state = decodeFacelets(f3);
  return state !== null && isSolvable(state);
}

// src/assemble.ts
var LOW_CONFIDENCE_THRESHOLD = 0.15;
function cubejsRoundTrips(facelets) {
  try {
    return import_cubejs.default.fromString(facelets).asString() === facelets;
  } catch {
    return false;
  }
}
function assemble(faces, threshold = LOW_CONFIDENCE_THRESHOLD) {
  if (!Number.isFinite(threshold)) {
    throw new Error(`lowConfidence threshold must be a finite number, got ${threshold}`);
  }
  const centers = [];
  const samples = [];
  for (const face of FACES) {
    const stickers = faces[face];
    if (!stickers || stickers.length !== 9) {
      throw new Error(`face ${face}: expected 9 samples, got ${stickers?.length ?? 0}`);
    }
    centers.push(stickers[4]);
    for (const rgb2 of stickers) samples.push(rgb2);
  }
  const { letters, confidence } = classify(samples, centers);
  const facelets = letters.join("");
  const valid = isStructurallyValid(facelets) && cubejsRoundTrips(facelets);
  let min = 1;
  const lowConfidence = [];
  for (let i = 0; i < confidence.length; i++) {
    const c2 = confidence[i];
    if (c2 < min) min = c2;
    if (c2 < threshold) lowConfidence.push(i);
  }
  return { facelets, valid, confidence: min, lowConfidence };
}

// src/camera.ts
function raceAbort(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("camera open aborted", "AbortError"));
      return;
    }
    const onAbort = () => reject(new DOMException("camera open aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}
async function openCamera(video, opts = {}, signal) {
  if (signal?.aborted) throw new DOMException("camera open aborted", "AbortError");
  const videoConstraints = opts.deviceId ? { deviceId: { exact: opts.deviceId } } : { facingMode: opts.facingMode ?? "environment" };
  if (opts.width) videoConstraints.width = { ideal: opts.width };
  if (opts.height) videoConstraints.height = { ideal: opts.height };
  const stream = await navigator.mediaDevices.getUserMedia({
    video: videoConstraints,
    audio: false
  });
  const release = () => {
    for (const track of stream.getTracks()) track.stop();
    if (video.srcObject === stream) video.srcObject = null;
  };
  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException("camera open aborted", "AbortError");
  };
  try {
    throwIfAborted();
    video.srcObject = stream;
    await raceAbort(video.play(), signal);
    throwIfAborted();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D canvas context unavailable");
    return {
      grab() {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w === 0 || h === 0) throw new Error("camera not ready: video has no dimensions yet");
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(video, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        return { data: img.data, width: img.width, height: img.height };
      },
      stop: release
    };
  } catch (err) {
    release();
    throw err;
  }
}

// src/onnx-postprocess.ts
function decodeDetections(data, numClasses, numAnchors, confThreshold = 0.25) {
  const rows = 4 + numClasses;
  if (data.length < rows * numAnchors) {
    throw new Error(`output too small: ${data.length} < ${rows * numAnchors}`);
  }
  const at2 = (r, a) => data[r * numAnchors + a];
  const out = [];
  for (let a = 0; a < numAnchors; a++) {
    let best = 0;
    let bestScore = at2(4, a);
    for (let c2 = 1; c2 < numClasses; c2++) {
      const s = at2(4 + c2, a);
      if (s > bestScore) {
        bestScore = s;
        best = c2;
      }
    }
    if (bestScore >= confThreshold) {
      out.push({
        cx: at2(0, a),
        cy: at2(1, a),
        w: at2(2, a),
        h: at2(3, a),
        classId: best,
        confidence: bestScore
      });
    }
  }
  return out;
}
function iou(a, b) {
  const ax0 = a.cx - a.w / 2;
  const ay0 = a.cy - a.h / 2;
  const bx0 = b.cx - b.w / 2;
  const by0 = b.cy - b.h / 2;
  const ix0 = Math.max(ax0, bx0);
  const iy0 = Math.max(ay0, by0);
  const ix1 = Math.min(ax0 + a.w, bx0 + b.w);
  const iy1 = Math.min(ay0 + a.h, by0 + b.h);
  const iw = Math.max(0, ix1 - ix0);
  const ih2 = Math.max(0, iy1 - iy0);
  const inter = iw * ih2;
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}
function nms(dets, iouThreshold = 0.45) {
  const order = [...dets].sort((a, b) => b.confidence - a.confidence);
  const kept = [];
  for (const d of order) {
    if (kept.every((k5) => iou(k5, d) < iouThreshold)) kept.push(d);
  }
  return kept;
}
function toGrid(nine) {
  const byY = [...nine].sort((a, b) => a.cy - b.cy);
  const rows = [byY.slice(0, 3), byY.slice(3, 6), byY.slice(6, 9)].map(
    (r) => r.sort((a, b) => a.cx - b.cx)
  );
  const size = nine.reduce((s, d) => s + (d.w + d.h) / 2, 0) / 9;
  for (const row of rows) {
    if (Math.max(...row.map((d) => d.cy)) - Math.min(...row.map((d) => d.cy)) > size) return null;
  }
  const rowY = rows.map((r) => r.reduce((s, d) => s + d.cy, 0) / 3);
  const colX = [0, 1, 2].map((c2) => rows.reduce((s, r) => s + r[c2].cx, 0) / 3);
  if (rowY[1] - rowY[0] < size * 0.4 || rowY[2] - rowY[1] < size * 0.4) return null;
  if (colX[1] - colX[0] < size * 0.4 || colX[2] - colX[1] < size * 0.4) return null;
  return rows.flat();
}
function fitFace(dets, minConf = 0.25) {
  const good = dets.filter((d) => d.confidence >= minConf && d.classId >= 0 && d.classId < 6);
  if (good.length === 0) return { ok: false, reason: "NO_FACE" };
  if (good.length < 9) return { ok: false, reason: "PARTIAL_FACE" };
  const nine = [...good].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 9);
  const grid = toGrid(nine);
  if (!grid) return { ok: false, reason: "BAD_GEOMETRY" };
  return {
    ok: true,
    face: {
      colors: grid.map((d) => d.classId),
      confidence: grid.map((d) => d.confidence),
      boxes: grid
    }
  };
}

// src/onnx-detect.ts
var IMG_SIZE = 640;
var PAD = 114 / 255;
function preprocess(frame, imgsz = IMG_SIZE) {
  const { data: src, width: w, height: h } = frame;
  const scale = imgsz / Math.max(w, h);
  const newW = Math.max(1, Math.round(w * scale));
  const newH = Math.max(1, Math.round(h * scale));
  const padX = Math.floor((imgsz - newW) / 2);
  const padY = Math.floor((imgsz - newH) / 2);
  const plane = imgsz * imgsz;
  const out = new Float32Array(3 * plane).fill(PAD);
  for (let y = 0; y < newH; y++) {
    const sy = Math.min(h - 1, Math.max(0, (y + 0.5) / scale - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(h - 1, y0 + 1);
    const fy = sy - y0;
    const oy = y + padY;
    for (let x = 0; x < newW; x++) {
      const sx = Math.min(w - 1, Math.max(0, (x + 0.5) / scale - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(w - 1, x0 + 1);
      const fx = sx - x0;
      const o = oy * imgsz + (x + padX);
      for (let ch2 = 0; ch2 < 3; ch2++) {
        const p00 = src[(y0 * w + x0) * 4 + ch2];
        const p01 = src[(y0 * w + x1) * 4 + ch2];
        const p10 = src[(y1 * w + x0) * 4 + ch2];
        const p11 = src[(y1 * w + x1) * 4 + ch2];
        const top = p00 + (p01 - p00) * fx;
        const bot = p10 + (p11 - p10) * fx;
        out[ch2 * plane + o] = (top + (bot - top) * fy) / 255;
      }
    }
  }
  return { data: out, imgsz, scale, padX, padY };
}
function sampleMedianRgb(frame, cx, cy, w, h) {
  const { data, width, height } = frame;
  const x0 = Math.max(0, Math.floor(cx - w * 0.25));
  const x1 = Math.min(width - 1, Math.ceil(cx + w * 0.25));
  const y0 = Math.max(0, Math.floor(cy - h * 0.25));
  const y1 = Math.min(height - 1, Math.ceil(cy + h * 0.25));
  const rs2 = [];
  const gs2 = [];
  const bs2 = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * width + x) * 4;
      rs2.push(data[i]);
      gs2.push(data[i + 1]);
      bs2.push(data[i + 2]);
    }
  }
  if (rs2.length === 0) return [128, 128, 128];
  const med = (a) => {
    a.sort((p4, q) => p4 - q);
    return a[a.length >> 1];
  };
  return [med(rs2), med(gs2), med(bs2)];
}
async function detectFace(frame, run, opts = {}) {
  const { numClasses = 6, confThreshold = 0.25, iouThreshold = 0.45, minConf = 0.25 } = opts;
  const pre = preprocess(frame);
  const { data, anchors } = await run(pre.data, pre.imgsz);
  const dets = nms(decodeDetections(data, numClasses, anchors, confThreshold), iouThreshold);
  const fit = fitFace(dets, minConf);
  if (!fit.ok) return fit;
  const rgb2 = fit.face.boxes.map(
    (d) => sampleMedianRgb(
      frame,
      (d.cx - pre.padX) / pre.scale,
      (d.cy - pre.padY) / pre.scale,
      d.w / pre.scale,
      d.h / pre.scale
    )
  );
  return { ok: true, face: { colors: fit.face.colors, confidence: fit.face.confidence, rgb: rgb2 } };
}

// node_modules/onnxruntime-web/dist/ort.bundle.min.mjs
var Wn = Object.defineProperty;
var ff = Object.getOwnPropertyDescriptor;
var hf = Object.getOwnPropertyNames;
var gf = Object.prototype.hasOwnProperty;
var Gn = ((t) => typeof __require < "u" ? __require : typeof Proxy < "u" ? new Proxy(t, { get: (e4, r) => (typeof __require < "u" ? __require : e4)[r] }) : t)(function(t) {
  if (typeof __require < "u") return __require.apply(this, arguments);
  throw Error('Dynamic require of "' + t + '" is not supported');
});
var V = (t, e4) => () => (t && (e4 = t(t = 0)), e4);
var Vt = (t, e4) => {
  for (var r in e4) Wn(t, r, { get: e4[r], enumerable: true });
};
var bf = (t, e4, r, n) => {
  if (e4 && typeof e4 == "object" || typeof e4 == "function") for (let o of hf(e4)) !gf.call(t, o) && o !== r && Wn(t, o, { get: () => e4[o], enumerable: !(n = ff(e4, o)) || n.enumerable });
  return t;
};
var Xt = (t) => bf(Wn({}, "__esModule", { value: true }), t);
var xr;
var Et;
var kt;
var yf;
var Oa;
var Hn = V(() => {
  "use strict";
  xr = /* @__PURE__ */ new Map(), Et = [], kt = (t, e4, r) => {
    if (e4 && typeof e4.init == "function" && typeof e4.createInferenceSessionHandler == "function") {
      let n = xr.get(t);
      if (n === void 0) xr.set(t, { backend: e4, priority: r });
      else {
        if (n.priority > r) return;
        if (n.priority === r && n.backend !== e4) throw new Error(`cannot register backend "${t}" using priority ${r}`);
      }
      if (r >= 0) {
        let o = Et.indexOf(t);
        o !== -1 && Et.splice(o, 1);
        for (let i = 0; i < Et.length; i++) if (xr.get(Et[i]).priority <= r) {
          Et.splice(i, 0, t);
          return;
        }
        Et.push(t);
      }
      return;
    }
    throw new TypeError("not a valid backend");
  }, yf = async (t) => {
    let e4 = xr.get(t);
    if (!e4) return "backend not found.";
    if (e4.initialized) return e4.backend;
    if (e4.aborted) return e4.error;
    {
      let r = !!e4.initPromise;
      try {
        return r || (e4.initPromise = e4.backend.init(t)), await e4.initPromise, e4.initialized = true, e4.backend;
      } catch (n) {
        return r || (e4.error = `${n}`, e4.aborted = true), e4.error;
      } finally {
        delete e4.initPromise;
      }
    }
  }, Oa = async (t) => {
    let e4 = t.executionProviders || [], r = e4.map((d) => typeof d == "string" ? d : d.name), n = r.length === 0 ? Et : r, o, i = [], s = /* @__PURE__ */ new Set();
    for (let d of n) {
      let c2 = await yf(d);
      typeof c2 == "string" ? i.push({ name: d, err: c2 }) : (o || (o = c2), o === c2 && s.add(d));
    }
    if (!o) throw new Error(`no available backend found. ERR: ${i.map((d) => `[${d.name}] ${d.err}`).join(", ")}`);
    for (let { name: d, err: c2 } of i) r.includes(d) && console.warn(`removing requested execution provider "${d}" from session options because it is not available: ${c2}`);
    let u = e4.filter((d) => s.has(typeof d == "string" ? d : d.name));
    return [o, new Proxy(t, { get: (d, c2) => c2 === "executionProviders" ? u : Reflect.get(d, c2) })];
  };
});
var za = V(() => {
  "use strict";
  Hn();
});
var Ba;
var Da = V(() => {
  "use strict";
  Ba = "1.27.0";
});
var Ma;
var Oe;
var Fn = V(() => {
  "use strict";
  Da();
  Ma = "warning", Oe = { wasm: {}, webgl: {}, webgpu: {}, versions: { common: Ba }, set logLevel(t) {
    if (t !== void 0) {
      if (typeof t != "string" || ["verbose", "info", "warning", "error", "fatal"].indexOf(t) === -1) throw new Error(`Unsupported logging level: ${t}`);
      Ma = t;
    }
  }, get logLevel() {
    return Ma;
  } };
  Object.defineProperty(Oe, "logLevel", { enumerable: true });
});
var _e;
var Ra = V(() => {
  "use strict";
  Fn();
  _e = Oe;
});
var Ua;
var Na;
var Va = V(() => {
  "use strict";
  Ua = (t, e4) => {
    let r = typeof document < "u" ? document.createElement("canvas") : new OffscreenCanvas(1, 1);
    r.width = t.dims[3], r.height = t.dims[2];
    let n = r.getContext("2d");
    if (n != null) {
      let o, i;
      e4?.tensorLayout !== void 0 && e4.tensorLayout === "NHWC" ? (o = t.dims[2], i = t.dims[3]) : (o = t.dims[3], i = t.dims[2]);
      let s = e4?.format !== void 0 ? e4.format : "RGB", u = e4?.norm, d, c2;
      u === void 0 || u.mean === void 0 ? d = [255, 255, 255, 255] : typeof u.mean == "number" ? d = [u.mean, u.mean, u.mean, u.mean] : (d = [u.mean[0], u.mean[1], u.mean[2], 0], u.mean[3] !== void 0 && (d[3] = u.mean[3])), u === void 0 || u.bias === void 0 ? c2 = [0, 0, 0, 0] : typeof u.bias == "number" ? c2 = [u.bias, u.bias, u.bias, u.bias] : (c2 = [u.bias[0], u.bias[1], u.bias[2], 0], u.bias[3] !== void 0 && (c2[3] = u.bias[3]));
      let p4 = i * o, m = 0, g = p4, y = p4 * 2, b = -1;
      s === "RGBA" ? (m = 0, g = p4, y = p4 * 2, b = p4 * 3) : s === "RGB" ? (m = 0, g = p4, y = p4 * 2) : s === "RBG" && (m = 0, y = p4, g = p4 * 2);
      for (let _ = 0; _ < i; _++) for (let T = 0; T < o; T++) {
        let x = (t.data[m++] - c2[0]) * d[0], $ = (t.data[g++] - c2[1]) * d[1], S = (t.data[y++] - c2[2]) * d[2], I = b === -1 ? 255 : (t.data[b++] - c2[3]) * d[3];
        n.fillStyle = "rgba(" + x + "," + $ + "," + S + "," + I + ")", n.fillRect(T, _, 1, 1);
      }
      if ("toDataURL" in r) return r.toDataURL();
      throw new Error("toDataURL is not supported");
    } else throw new Error("Can not access image data");
  }, Na = (t, e4) => {
    let r = typeof document < "u" ? document.createElement("canvas").getContext("2d") : new OffscreenCanvas(1, 1).getContext("2d"), n;
    if (r != null) {
      let o, i, s;
      e4?.tensorLayout !== void 0 && e4.tensorLayout === "NHWC" ? (o = t.dims[2], i = t.dims[1], s = t.dims[3]) : (o = t.dims[3], i = t.dims[2], s = t.dims[1]);
      let u = e4 !== void 0 && e4.format !== void 0 ? e4.format : "RGB", d = e4?.norm, c2, p4;
      d === void 0 || d.mean === void 0 ? c2 = [255, 255, 255, 255] : typeof d.mean == "number" ? c2 = [d.mean, d.mean, d.mean, d.mean] : (c2 = [d.mean[0], d.mean[1], d.mean[2], 255], d.mean[3] !== void 0 && (c2[3] = d.mean[3])), d === void 0 || d.bias === void 0 ? p4 = [0, 0, 0, 0] : typeof d.bias == "number" ? p4 = [d.bias, d.bias, d.bias, d.bias] : (p4 = [d.bias[0], d.bias[1], d.bias[2], 0], d.bias[3] !== void 0 && (p4[3] = d.bias[3]));
      let m = i * o;
      if (e4 !== void 0 && (e4.format !== void 0 && s === 4 && e4.format !== "RGBA" || s === 3 && e4.format !== "RGB" && e4.format !== "BGR")) throw new Error("Tensor format doesn't match input tensor dims");
      let g = 4, y = 0, b = 1, _ = 2, T = 3, x = 0, $ = m, S = m * 2, I = -1;
      u === "RGBA" ? (x = 0, $ = m, S = m * 2, I = m * 3) : u === "RGB" ? (x = 0, $ = m, S = m * 2) : u === "RBG" && (x = 0, S = m, $ = m * 2), n = r.createImageData(o, i);
      for (let E = 0; E < i * o; y += g, b += g, _ += g, T += g, E++) n.data[y] = (t.data[x++] - p4[0]) * c2[0], n.data[b] = (t.data[$++] - p4[1]) * c2[1], n.data[_] = (t.data[S++] - p4[2]) * c2[2], n.data[T] = I === -1 ? 255 : (t.data[I++] - p4[3]) * c2[3];
    } else throw new Error("Can not access image data");
    return n;
  };
});
var qn;
var La;
var Wa;
var Ga;
var Ha;
var Fa;
var qa = V(() => {
  "use strict";
  Sr();
  qn = (t, e4) => {
    if (t === void 0) throw new Error("Image buffer must be defined");
    if (e4.height === void 0 || e4.width === void 0) throw new Error("Image height and width must be defined");
    if (e4.tensorLayout === "NHWC") throw new Error("NHWC Tensor layout is not supported yet");
    let { height: r, width: n } = e4, o = e4.norm ?? { mean: 255, bias: 0 }, i, s;
    typeof o.mean == "number" ? i = [o.mean, o.mean, o.mean, o.mean] : i = [o.mean[0], o.mean[1], o.mean[2], o.mean[3] ?? 255], typeof o.bias == "number" ? s = [o.bias, o.bias, o.bias, o.bias] : s = [o.bias[0], o.bias[1], o.bias[2], o.bias[3] ?? 0];
    let u = e4.format !== void 0 ? e4.format : "RGBA", d = e4.tensorFormat !== void 0 && e4.tensorFormat !== void 0 ? e4.tensorFormat : "RGB", c2 = r * n, p4 = d === "RGBA" ? new Float32Array(c2 * 4) : new Float32Array(c2 * 3), m = 4, g = 0, y = 1, b = 2, _ = 3, T = 0, x = c2, $ = c2 * 2, S = -1;
    u === "RGB" && (m = 3, g = 0, y = 1, b = 2, _ = -1), d === "RGBA" ? S = c2 * 3 : d === "RBG" ? (T = 0, $ = c2, x = c2 * 2) : d === "BGR" && ($ = 0, x = c2, T = c2 * 2);
    for (let E = 0; E < c2; E++, g += m, b += m, y += m, _ += m) p4[T++] = (t[g] + s[0]) / i[0], p4[x++] = (t[y] + s[1]) / i[1], p4[$++] = (t[b] + s[2]) / i[2], S !== -1 && _ !== -1 && (p4[S++] = (t[_] + s[3]) / i[3]);
    return d === "RGBA" ? new De("float32", p4, [1, 4, r, n]) : new De("float32", p4, [1, 3, r, n]);
  }, La = async (t, e4) => {
    let r = typeof HTMLImageElement < "u" && t instanceof HTMLImageElement, n = typeof ImageData < "u" && t instanceof ImageData, o = typeof ImageBitmap < "u" && t instanceof ImageBitmap, i = typeof t == "string", s, u = e4 ?? {}, d = () => {
      if (typeof document < "u") return document.createElement("canvas");
      if (typeof OffscreenCanvas < "u") return new OffscreenCanvas(1, 1);
      throw new Error("Canvas is not supported");
    }, c2 = (p4) => typeof HTMLCanvasElement < "u" && p4 instanceof HTMLCanvasElement || p4 instanceof OffscreenCanvas ? p4.getContext("2d") : null;
    if (r) {
      let p4 = d();
      p4.width = t.width, p4.height = t.height;
      let m = c2(p4);
      if (m != null) {
        let g = t.height, y = t.width;
        if (e4 !== void 0 && e4.resizedHeight !== void 0 && e4.resizedWidth !== void 0 && (g = e4.resizedHeight, y = e4.resizedWidth), e4 !== void 0) {
          if (u = e4, e4.tensorFormat !== void 0) throw new Error("Image input config format must be RGBA for HTMLImageElement");
          u.tensorFormat = "RGBA", u.height = g, u.width = y;
        } else u.tensorFormat = "RGBA", u.height = g, u.width = y;
        m.drawImage(t, 0, 0), s = m.getImageData(0, 0, y, g).data;
      } else throw new Error("Can not access image data");
    } else if (n) {
      let p4, m;
      if (e4 !== void 0 && e4.resizedWidth !== void 0 && e4.resizedHeight !== void 0 ? (p4 = e4.resizedHeight, m = e4.resizedWidth) : (p4 = t.height, m = t.width), e4 !== void 0 && (u = e4), u.format = "RGBA", u.height = p4, u.width = m, e4 !== void 0) {
        let g = d();
        g.width = m, g.height = p4;
        let y = c2(g);
        if (y != null) y.putImageData(t, 0, 0), s = y.getImageData(0, 0, m, p4).data;
        else throw new Error("Can not access image data");
      } else s = t.data;
    } else if (o) {
      if (e4 === void 0) throw new Error("Please provide image config with format for Imagebitmap");
      let p4 = d();
      p4.width = t.width, p4.height = t.height;
      let m = c2(p4);
      if (m != null) {
        let g = t.height, y = t.width;
        return m.drawImage(t, 0, 0, y, g), s = m.getImageData(0, 0, y, g).data, u.height = g, u.width = y, qn(s, u);
      } else throw new Error("Can not access image data");
    } else {
      if (i) return new Promise((p4, m) => {
        let g = d(), y = c2(g);
        if (!t || !y) return m();
        let b = new Image();
        b.crossOrigin = "Anonymous", b.src = t, b.onload = () => {
          g.width = b.width, g.height = b.height, y.drawImage(b, 0, 0, g.width, g.height);
          let _ = y.getImageData(0, 0, g.width, g.height);
          u.height = g.height, u.width = g.width, p4(qn(_.data, u));
        };
      });
      throw new Error("Input data provided is not supported - aborted tensor creation");
    }
    if (s !== void 0) return qn(s, u);
    throw new Error("Input data provided is not supported - aborted tensor creation");
  }, Wa = (t, e4) => {
    let { width: r, height: n, download: o, dispose: i } = e4, s = [1, n, r, 4];
    return new De({ location: "texture", type: "float32", texture: t, dims: s, download: o, dispose: i });
  }, Ga = (t, e4) => {
    let { dataType: r, dims: n, download: o, dispose: i } = e4;
    return new De({ location: "gpu-buffer", type: r ?? "float32", gpuBuffer: t, dims: n, download: o, dispose: i });
  }, Ha = (t, e4) => {
    let { dataType: r, dims: n, download: o, dispose: i } = e4;
    return new De({ location: "ml-tensor", type: r ?? "float32", mlTensor: t, dims: n, download: o, dispose: i });
  }, Fa = (t, e4, r) => new De({ location: "cpu-pinned", type: t, data: e4, dims: r ?? [e4.length] });
});
var Pt;
var Jt;
var Ka;
var ja;
var Za = V(() => {
  "use strict";
  Pt = /* @__PURE__ */ new Map([["float32", Float32Array], ["uint8", Uint8Array], ["int8", Int8Array], ["uint16", Uint16Array], ["int16", Int16Array], ["int32", Int32Array], ["bool", Uint8Array], ["float64", Float64Array], ["uint32", Uint32Array], ["int4", Uint8Array], ["uint4", Uint8Array]]), Jt = /* @__PURE__ */ new Map([[Float32Array, "float32"], [Uint8Array, "uint8"], [Int8Array, "int8"], [Uint16Array, "uint16"], [Int16Array, "int16"], [Int32Array, "int32"], [Float64Array, "float64"], [Uint32Array, "uint32"]]), Ka = false, ja = () => {
    if (!Ka) {
      Ka = true;
      let t = typeof BigInt64Array < "u" && BigInt64Array.from, e4 = typeof BigUint64Array < "u" && BigUint64Array.from, r = globalThis.Float16Array, n = typeof r < "u" && r.from;
      t && (Pt.set("int64", BigInt64Array), Jt.set(BigInt64Array, "int64")), e4 && (Pt.set("uint64", BigUint64Array), Jt.set(BigUint64Array, "uint64")), n ? (Pt.set("float16", r), Jt.set(r, "float16")) : Pt.set("float16", Uint16Array);
    }
  };
});
var Qa;
var Ya;
var Xa = V(() => {
  "use strict";
  Sr();
  Qa = (t) => {
    let e4 = 1;
    for (let r = 0; r < t.length; r++) {
      let n = t[r];
      if (typeof n != "number" || !Number.isSafeInteger(n)) throw new TypeError(`dims[${r}] must be an integer, got: ${n}`);
      if (n < 0) throw new RangeError(`dims[${r}] must be a non-negative integer, got: ${n}`);
      e4 *= n;
    }
    return e4;
  }, Ya = (t, e4) => {
    switch (t.location) {
      case "cpu":
        return new De(t.type, t.data, e4);
      case "cpu-pinned":
        return new De({ location: "cpu-pinned", data: t.data, type: t.type, dims: e4 });
      case "texture":
        return new De({ location: "texture", texture: t.texture, type: t.type, dims: e4 });
      case "gpu-buffer":
        return new De({ location: "gpu-buffer", gpuBuffer: t.gpuBuffer, type: t.type, dims: e4 });
      case "ml-tensor":
        return new De({ location: "ml-tensor", mlTensor: t.mlTensor, type: t.type, dims: e4 });
      default:
        throw new Error(`tensorReshape: tensor location ${t.location} is not supported`);
    }
  };
});
var De;
var Sr = V(() => {
  "use strict";
  Va();
  qa();
  Za();
  Xa();
  De = class {
    constructor(e4, r, n) {
      ja();
      let o, i;
      if (typeof e4 == "object" && "location" in e4) switch (this.dataLocation = e4.location, o = e4.type, i = e4.dims, e4.location) {
        case "cpu-pinned": {
          let u = Pt.get(o);
          if (!u) throw new TypeError(`unsupported type "${o}" to create tensor from pinned buffer`);
          if (!(e4.data instanceof u)) throw new TypeError(`buffer should be of type ${u.name}`);
          this.cpuData = e4.data;
          break;
        }
        case "texture": {
          if (o !== "float32") throw new TypeError(`unsupported type "${o}" to create tensor from texture`);
          this.gpuTextureData = e4.texture, this.downloader = e4.download, this.disposer = e4.dispose;
          break;
        }
        case "gpu-buffer": {
          if (o !== "float32" && o !== "float16" && o !== "int32" && o !== "int64" && o !== "uint32" && o !== "uint8" && o !== "bool" && o !== "uint4" && o !== "int4") throw new TypeError(`unsupported type "${o}" to create tensor from gpu buffer`);
          this.gpuBufferData = e4.gpuBuffer, this.downloader = e4.download, this.disposer = e4.dispose;
          break;
        }
        case "ml-tensor": {
          if (o !== "float32" && o !== "float16" && o !== "int32" && o !== "int64" && o !== "uint32" && o !== "uint64" && o !== "int8" && o !== "uint8" && o !== "bool" && o !== "uint4" && o !== "int4") throw new TypeError(`unsupported type "${o}" to create tensor from MLTensor`);
          this.mlTensorData = e4.mlTensor, this.downloader = e4.download, this.disposer = e4.dispose;
          break;
        }
        default:
          throw new Error(`Tensor constructor: unsupported location '${this.dataLocation}'`);
      }
      else {
        let u, d;
        if (typeof e4 == "string") if (o = e4, d = n, e4 === "string") {
          if (!Array.isArray(r)) throw new TypeError("A string tensor's data must be a string array.");
          u = r;
        } else {
          let c2 = Pt.get(e4);
          if (c2 === void 0) throw new TypeError(`Unsupported tensor type: ${e4}.`);
          if (Array.isArray(r)) {
            if (e4 === "float16" && c2 === Uint16Array || e4 === "uint4" || e4 === "int4") throw new TypeError(`Creating a ${e4} tensor from number array is not supported. Please use ${c2.name} as data.`);
            e4 === "uint64" || e4 === "int64" ? u = c2.from(r, BigInt) : u = c2.from(r);
          } else if (r instanceof c2) u = r;
          else if (r instanceof Uint8ClampedArray) if (e4 === "uint8") u = Uint8Array.from(r);
          else throw new TypeError("A Uint8ClampedArray tensor's data must be type of uint8");
          else if (e4 === "float16" && r instanceof Uint16Array && c2 !== Uint16Array) u = new globalThis.Float16Array(r.buffer, r.byteOffset, r.length);
          else throw new TypeError(`A ${o} tensor's data must be type of ${c2}`);
        }
        else if (d = r, Array.isArray(e4)) {
          if (e4.length === 0) throw new TypeError("Tensor type cannot be inferred from an empty array.");
          let c2 = typeof e4[0];
          if (c2 === "string") o = "string", u = e4;
          else if (c2 === "boolean") o = "bool", u = Uint8Array.from(e4);
          else throw new TypeError(`Invalid element type of data array: ${c2}.`);
        } else if (e4 instanceof Uint8ClampedArray) o = "uint8", u = Uint8Array.from(e4);
        else {
          let c2 = Jt.get(e4.constructor);
          if (c2 === void 0) throw new TypeError(`Unsupported type for tensor data: ${e4.constructor}.`);
          o = c2, u = e4;
        }
        if (d === void 0) d = [u.length];
        else if (!Array.isArray(d)) throw new TypeError("A tensor's dims must be a number array");
        i = d, this.cpuData = u, this.dataLocation = "cpu";
      }
      let s = Qa(i);
      if (this.cpuData && s !== this.cpuData.length && !((o === "uint4" || o === "int4") && Math.ceil(s / 2) === this.cpuData.length)) throw new Error(`Tensor's size(${s}) does not match data length(${this.cpuData.length}).`);
      this.type = o, this.dims = i, this.size = s;
    }
    static async fromImage(e4, r) {
      return La(e4, r);
    }
    static fromTexture(e4, r) {
      return Wa(e4, r);
    }
    static fromGpuBuffer(e4, r) {
      return Ga(e4, r);
    }
    static fromMLTensor(e4, r) {
      return Ha(e4, r);
    }
    static fromPinnedBuffer(e4, r, n) {
      return Fa(e4, r, n);
    }
    toDataURL(e4) {
      return Ua(this, e4);
    }
    toImageData(e4) {
      return Na(this, e4);
    }
    get data() {
      if (this.ensureValid(), !this.cpuData) throw new Error("The data is not on CPU. Use `getData()` to download GPU data to CPU, or use `texture` or `gpuBuffer` property to access the GPU data directly.");
      return this.cpuData;
    }
    get location() {
      return this.dataLocation;
    }
    get texture() {
      if (this.ensureValid(), !this.gpuTextureData) throw new Error("The data is not stored as a WebGL texture.");
      return this.gpuTextureData;
    }
    get gpuBuffer() {
      if (this.ensureValid(), !this.gpuBufferData) throw new Error("The data is not stored as a WebGPU buffer.");
      return this.gpuBufferData;
    }
    get mlTensor() {
      if (this.ensureValid(), !this.mlTensorData) throw new Error("The data is not stored as a WebNN MLTensor.");
      return this.mlTensorData;
    }
    async getData(e4) {
      switch (this.ensureValid(), this.dataLocation) {
        case "cpu":
        case "cpu-pinned":
          return this.data;
        case "texture":
        case "gpu-buffer":
        case "ml-tensor": {
          if (!this.downloader) throw new Error("The current tensor is not created with a specified data downloader.");
          if (this.isDownloading) throw new Error("The current tensor is being downloaded.");
          try {
            this.isDownloading = true;
            let r = await this.downloader();
            return this.downloader = void 0, this.dataLocation = "cpu", this.cpuData = r, e4 && this.disposer && (this.disposer(), this.disposer = void 0), r;
          } finally {
            this.isDownloading = false;
          }
        }
        default:
          throw new Error(`cannot get data from location: ${this.dataLocation}`);
      }
    }
    dispose() {
      if (this.isDownloading) throw new Error("The current tensor is being downloaded.");
      this.disposer && (this.disposer(), this.disposer = void 0), this.cpuData = void 0, this.gpuTextureData = void 0, this.gpuBufferData = void 0, this.mlTensorData = void 0, this.downloader = void 0, this.isDownloading = void 0, this.dataLocation = "none";
    }
    ensureValid() {
      if (this.dataLocation === "none") throw new Error("The tensor is disposed.");
    }
    reshape(e4) {
      if (this.ensureValid(), this.downloader || this.disposer) throw new Error("Cannot reshape a tensor that owns GPU resource.");
      return Ya(this, e4);
    }
  };
});
var je;
var Kn = V(() => {
  "use strict";
  Sr();
  je = De;
});
var Tr;
var Ja;
var Ve;
var Re;
var _t;
var wt;
var jn = V(() => {
  "use strict";
  Fn();
  Tr = (t, e4) => {
    (typeof Oe.trace > "u" ? !Oe.wasm.trace : !Oe.trace) || console.timeStamp(`${t}::ORT::${e4}`);
  }, Ja = (t, e4) => {
    let r = new Error().stack?.split(/\r\n|\r|\n/g) || [], n = false;
    for (let o = 0; o < r.length; o++) {
      if (n && !r[o].includes("TRACE_FUNC")) {
        let i = `FUNC_${t}::${r[o].trim().split(" ")[1]}`;
        e4 && (i += `::${e4}`), Tr("CPU", i);
        return;
      }
      r[o].includes("TRACE_FUNC") && (n = true);
    }
  }, Ve = (t) => {
    (typeof Oe.trace > "u" ? !Oe.wasm.trace : !Oe.trace) || Ja("BEGIN", t);
  }, Re = (t) => {
    (typeof Oe.trace > "u" ? !Oe.wasm.trace : !Oe.trace) || Ja("END", t);
  }, _t = (t) => {
    (typeof Oe.trace > "u" ? !Oe.wasm.trace : !Oe.trace) || console.time(`ORT::${t}`);
  }, wt = (t) => {
    (typeof Oe.trace > "u" ? !Oe.wasm.trace : !Oe.trace) || console.timeEnd(`ORT::${t}`);
  };
});
var Ir;
var es = V(() => {
  "use strict";
  Hn();
  Kn();
  jn();
  Ir = class t {
    constructor(e4) {
      this.handler = e4;
    }
    async run(e4, r, n) {
      Ve(), _t("InferenceSession.run");
      let o = {}, i = {};
      if (typeof e4 != "object" || e4 === null || e4 instanceof je || Array.isArray(e4)) throw new TypeError("'feeds' must be an object that use input names as keys and OnnxValue as corresponding values.");
      let s = true;
      if (typeof r == "object") {
        if (r === null) throw new TypeError("Unexpected argument[1]: cannot be null.");
        if (r instanceof je) throw new TypeError("'fetches' cannot be a Tensor");
        if (Array.isArray(r)) {
          if (r.length === 0) throw new TypeError("'fetches' cannot be an empty array.");
          s = false;
          for (let c2 of r) {
            if (typeof c2 != "string") throw new TypeError("'fetches' must be a string array or an object.");
            if (this.outputNames.indexOf(c2) === -1) throw new RangeError(`'fetches' contains invalid output name: ${c2}.`);
            o[c2] = null;
          }
          if (typeof n == "object" && n !== null) i = n;
          else if (typeof n < "u") throw new TypeError("'options' must be an object.");
        } else {
          let c2 = false, p4 = Object.getOwnPropertyNames(r);
          for (let m of this.outputNames) if (p4.indexOf(m) !== -1) {
            let g = r[m];
            (g === null || g instanceof je) && (c2 = true, s = false, o[m] = g);
          }
          if (c2) {
            if (typeof n == "object" && n !== null) i = n;
            else if (typeof n < "u") throw new TypeError("'options' must be an object.");
          } else i = r;
        }
      } else if (typeof r < "u") throw new TypeError("Unexpected argument[1]: must be 'fetches' or 'options'.");
      for (let c2 of this.inputNames) if (typeof e4[c2] > "u") throw new Error(`input '${c2}' is missing in 'feeds'.`);
      if (s) for (let c2 of this.outputNames) o[c2] = null;
      let u = await this.handler.run(e4, o, i), d = {};
      for (let c2 in u) if (Object.hasOwnProperty.call(u, c2)) {
        let p4 = u[c2];
        p4 instanceof je ? d[c2] = p4 : d[c2] = new je(p4.type, p4.data, p4.dims);
      }
      return wt("InferenceSession.run"), Re(), d;
    }
    async release() {
      return this.handler.dispose();
    }
    static async create(e4, r, n, o) {
      Ve(), _t("InferenceSession.create");
      let i, s = {};
      if (typeof e4 == "string") {
        if (i = e4, typeof r == "object" && r !== null) s = r;
        else if (typeof r < "u") throw new TypeError("'options' must be an object.");
      } else if (e4 instanceof Uint8Array) {
        if (i = e4, typeof r == "object" && r !== null) s = r;
        else if (typeof r < "u") throw new TypeError("'options' must be an object.");
      } else if (e4 instanceof ArrayBuffer || typeof SharedArrayBuffer < "u" && e4 instanceof SharedArrayBuffer) {
        let p4 = e4, m = 0, g = e4.byteLength;
        if (typeof r == "object" && r !== null) s = r;
        else if (typeof r == "number") {
          if (m = r, !Number.isSafeInteger(m)) throw new RangeError("'byteOffset' must be an integer.");
          if (m < 0 || m >= p4.byteLength) throw new RangeError(`'byteOffset' is out of range [0, ${p4.byteLength}).`);
          if (g = e4.byteLength - m, typeof n == "number") {
            if (g = n, !Number.isSafeInteger(g)) throw new RangeError("'byteLength' must be an integer.");
            if (g <= 0 || m + g > p4.byteLength) throw new RangeError(`'byteLength' is out of range (0, ${p4.byteLength - m}].`);
            if (typeof o == "object" && o !== null) s = o;
            else if (typeof o < "u") throw new TypeError("'options' must be an object.");
          } else if (typeof n < "u") throw new TypeError("'byteLength' must be a number.");
        } else if (typeof r < "u") throw new TypeError("'options' must be an object.");
        i = new Uint8Array(p4, m, g);
      } else throw new TypeError("Unexpected argument[0]: must be 'path' or 'buffer'.");
      let [u, d] = await Oa(s), c2 = await u.createInferenceSessionHandler(i, d);
      return wt("InferenceSession.create"), Re(), new t(c2);
    }
    startProfiling() {
      this.handler.startProfiling();
    }
    endProfiling() {
      this.handler.endProfiling();
    }
    get inputNames() {
      return this.handler.inputNames;
    }
    get outputNames() {
      return this.handler.outputNames;
    }
    get inputMetadata() {
      return this.handler.inputMetadata;
    }
    get outputMetadata() {
      return this.handler.outputMetadata;
    }
  };
});
var _f;
var ts = V(() => {
  "use strict";
  es();
  _f = Ir;
});
var rs = V(() => {
  "use strict";
});
var ns = V(() => {
  "use strict";
});
var os = V(() => {
  "use strict";
});
var is = V(() => {
  "use strict";
});
var Zn = {};
Vt(Zn, { InferenceSession: () => _f, TRACE: () => Tr, TRACE_EVENT_BEGIN: () => _t, TRACE_EVENT_END: () => wt, TRACE_FUNC_BEGIN: () => Ve, TRACE_FUNC_END: () => Re, Tensor: () => je, env: () => _e, registerBackend: () => kt });
var Le = V(() => {
  "use strict";
  za();
  Ra();
  ts();
  Kn();
  rs();
  ns();
  jn();
  os();
  is();
});
var Cr = V(() => {
  "use strict";
});
var ds = {};
Vt(ds, { default: () => wf });
var ss;
var us;
var wf;
var ls = V(() => {
  "use strict";
  Qn();
  vt();
  Ar();
  ss = "ort-wasm-proxy-worker", us = globalThis.self?.name === ss;
  us && (self.onmessage = (t) => {
    let { type: e4, in: r } = t.data;
    try {
      switch (e4) {
        case "init-wasm":
          Er(r.wasm).then(() => {
            kr(r).then(() => {
              postMessage({ type: e4 });
            }, (n) => {
              postMessage({ type: e4, err: n });
            });
          }, (n) => {
            postMessage({ type: e4, err: n });
          });
          break;
        case "init-ep": {
          let { epName: n, env: o } = r;
          Pr(o, n).then(() => {
            postMessage({ type: e4 });
          }, (i) => {
            postMessage({ type: e4, err: i });
          });
          break;
        }
        case "copy-from": {
          let { buffer: n } = r, o = er(n);
          postMessage({ type: e4, out: o });
          break;
        }
        case "create": {
          let { model: n, options: o } = r;
          Or(n, o).then((i) => {
            postMessage({ type: e4, out: i });
          }, (i) => {
            postMessage({ type: e4, err: i });
          });
          break;
        }
        case "release":
          zr(r), postMessage({ type: e4 });
          break;
        case "run": {
          let { sessionId: n, inputIndices: o, inputs: i, outputIndices: s, options: u } = r;
          Br(n, o, i, s, new Array(s.length).fill(null), u).then((d) => {
            d.some((c2) => c2[3] !== "cpu") ? postMessage({ type: e4, err: "Proxy does not support non-cpu tensor location." }) : postMessage({ type: e4, out: d }, Mr([...i, ...d]));
          }, (d) => {
            postMessage({ type: e4, err: d });
          });
          break;
        }
        case "end-profiling":
          Dr(r), postMessage({ type: e4 });
          break;
        default:
      }
    } catch (n) {
      postMessage({ type: e4, err: n });
    }
  });
  wf = us ? null : (t) => new Worker(t ?? We, { type: "module", name: ss });
});
var ps = {};
Vt(ps, { default: () => vf });
async function cs(t = {}) {
  var e4 = t, r = !!globalThis.window, n = !!globalThis.WorkerGlobalScope, o = n && self.name?.startsWith("em-pthread");
  e4.mountExternalData = (a, l) => {
    a.startsWith("./") && (a = a.substring(2)), (e4.Xc || (e4.Xc = /* @__PURE__ */ new Map())).set(a, l);
  }, e4.unmountExternalData = () => {
    delete e4.Xc;
  }, globalThis.SharedArrayBuffer ?? new WebAssembly.Memory({ initial: 0, maximum: 0, shared: true }).buffer.constructor;
  let i = (a) => async (...l) => {
    try {
      if (e4.Yc) throw Error("Session already started");
      let h = e4.Yc = { Kd: l[0], errors: [] }, f3 = await a(...l);
      if (e4.Yc !== h) throw Error("Session mismatch");
      e4.dd?.flush();
      let w = h.errors;
      if (0 < w.length) {
        let C = await Promise.all(w);
        if (C = C.filter((P) => P), 0 < C.length) throw Error(C.join(`
`));
      }
      return f3;
    } finally {
      e4.Yc = null;
    }
  };
  e4.jsepInit = (a, l) => {
    if (a === "webgpu") {
      [e4.dd, e4.Ad, e4.Ed, e4.ed, e4.Dd, e4.$b, e4.Fd, e4.Hd, e4.Bd, e4.Cd, e4.Gd] = l;
      let h = e4.dd;
      e4.jsepRegisterBuffer = (f3, w, C, P) => h.registerBuffer(f3, w, C, P), e4.jsepGetBuffer = (f3) => h.getBuffer(f3), e4.jsepCreateDownloader = (f3, w, C) => h.createDownloader(f3, w, C), e4.jsepOnCreateSession = (f3) => {
        h.onCreateSession(f3);
      }, e4.jsepOnReleaseSession = (f3) => {
        h.onReleaseSession(f3);
      }, e4.jsepOnRunStart = (f3) => h.onRunStart(f3), e4.Id = (f3, w) => {
        h.upload(f3, w);
      };
    } else if (a === "webnn") {
      let h = l[0];
      [e4.Sd, e4.sd, e4.webnnEnsureTensor, e4.td, e4.webnnDownloadTensor, e4.Rd, e4.webnnEnableTraceEvent] = l.slice(1), e4.webnnReleaseTensorId = e4.sd, e4.webnnUploadTensor = e4.td, e4.webnnRegisterMLContext = e4.Rd, e4.webnnOnRunStart = (f3) => h.onRunStart(f3), e4.webnnOnRunEnd = h.onRunEnd.bind(h), e4.webnnOnReleaseSession = (f3) => {
        h.onReleaseSession(f3);
      }, e4.webnnCreateMLTensorDownloader = (f3, w) => h.createMLTensorDownloader(f3, w), e4.webnnRegisterMLTensor = (f3, w, C, P) => h.registerMLTensor(f3, w, C, P), e4.webnnCreateMLContext = (f3) => h.createMLContext(f3), e4.webnnRegisterMLConstant = (f3, w, C, P, D, H) => h.registerMLConstant(f3, w, C, P, D, e4.Xc, H), e4.webnnRegisterGraphInput = h.registerGraphInput.bind(h), e4.webnnIsGraphInput = h.isGraphInput.bind(h), e4.webnnRegisterGraphOutput = h.registerGraphOutput.bind(h), e4.webnnIsGraphOutput = h.isGraphOutput.bind(h), e4.webnnCreateTemporaryTensor = h.createTemporaryTensor.bind(h), e4.webnnIsGraphInputOutputTypeSupported = h.isGraphInputOutputTypeSupported.bind(h);
    }
  };
  let s = () => {
    let a = (l) => (...h) => {
      let f3 = et;
      return h = l(...h), et != f3 ? new Promise((w, C) => {
        En = { resolve: w, reject: C };
      }) : h;
    };
    (() => {
      for (let l of ["_OrtAppendExecutionProvider", "_OrtCreateSession", "_OrtRun", "_OrtRunWithBinding", "_OrtBindInput"]) e4[l] = a(e4[l]);
    })(), i !== void 0 && (e4._OrtRun = i(e4._OrtRun), e4._OrtRunWithBinding = i(e4._OrtRunWithBinding)), s = void 0;
  };
  e4.asyncInit = () => {
    s?.();
  };
  var u, d, c2 = (a, l) => {
    throw l;
  }, p4 = import.meta.url, m = "";
  if (r || n) {
    try {
      m = new URL(".", p4).href;
    } catch {
    }
    n && (d = (a) => {
      var l = new XMLHttpRequest();
      return l.open("GET", a, false), l.responseType = "arraybuffer", l.send(null), new Uint8Array(l.response);
    }), u = async (a) => {
      if (z(a)) return new Promise((h, f3) => {
        var w = new XMLHttpRequest();
        w.open("GET", a, true), w.responseType = "arraybuffer", w.onload = () => {
          w.status == 200 || w.status == 0 && w.response ? h(w.response) : f3(w.status);
        }, w.onerror = f3, w.send(null);
      });
      var l = await fetch(a, { credentials: "same-origin" });
      if (l.ok) return l.arrayBuffer();
      throw Error(l.status + " : " + l.url);
    };
  }
  var g, y, b, _, T, x, $ = console.log.bind(console), S = console.error.bind(console), I = $, E = S, A = false, z = (a) => a.startsWith("file://");
  function v() {
    ht.buffer != N.buffer && Me();
  }
  if (o) {
    let a = function(l) {
      try {
        var h = l.data, f3 = h.Sc;
        if (f3 === "load") {
          let w = [];
          self.onmessage = (C) => w.push(C), x = () => {
            postMessage({ Sc: "loaded" });
            for (let C of w) a(C);
            self.onmessage = a;
          };
          for (let C of h.xd) e4[C] && !e4[C].proxy || (e4[C] = (...P) => {
            postMessage({ Sc: "callHandler", wd: C, args: P });
          }, C == "print" && (I = e4[C]), C == "printErr" && (E = e4[C]));
          ht = h.Od, Me(), y = h.Pd, be(), $r();
        } else if (f3 === "run") {
          (function(w) {
            var C = (v(), L)[w + 52 >>> 2 >>> 0];
            w = (v(), L)[w + 56 >>> 2 >>> 0], Wi(C, C - w), ue(C);
          })(h.Rc), Bn(h.Rc, 0, 0, 1, 0, 0), Go(), In(h.Rc), R || (Mi(), R = true);
          try {
            np(h.Md, h.bd);
          } catch (w) {
            if (w != "unwind") throw w;
          }
        } else h.target !== "setimmediate" && (f3 === "checkMailbox" ? R && hr() : f3 && (E(`worker: received unknown command ${f3}`), E(h)));
      } catch (w) {
        throw Ri(), w;
      }
    };
    var Zb = a, R = false;
    self.onunhandledrejection = (l) => {
      throw l.reason || l;
    }, self.onmessage = a;
  }
  var N, F, q, X, B, L, Q, Y, Z, te, ae, le = false;
  function Me() {
    var a = ht.buffer;
    e4.HEAP8 = N = new Int8Array(a), q = new Int16Array(a), e4.HEAPU8 = F = new Uint8Array(a), X = new Uint16Array(a), e4.HEAP32 = B = new Int32Array(a), e4.HEAPU32 = L = new Uint32Array(a), Q = new Float32Array(a), Y = new Float64Array(a), Z = new BigInt64Array(a), te = new BigUint64Array(a);
  }
  function ve() {
    le = true, o ? x() : ct.sb();
  }
  function M3(a) {
    throw E(a = "Aborted(" + a + ")"), A = true, a = new WebAssembly.RuntimeError(a + ". Build with -sASSERTIONS for more info."), T?.(a), a;
  }
  function G() {
    return { a: { ma: Am, gb: Cm, g: op, J: ip, f: ap, o: sp, h: up, ha: dp, b: lp, T: cp, Ha: Zo, n: pp, $: Jo, Xa: ei, Da: ti, Fa: ri, Ya: ni, Va: oi, Oa: ii, Ua: ai, ka: si, Ea: ui, Ba: di, Wa: li, Ca: ci, bb: mp, ea: hp, wa: gp, ua: yp, da: wp, O: vp, H: $p, va: xp, _: kp, xa: Pp, Ra: Op, za: Bp, Ia: Dp, sa: Mp, fa: Rp, Qa: In, _a: Up, R: Wp, r: Kp, c: Sn, hb: jp, y: Zp, M: Qp, D: Yp, l: Xp, s: _i2, ib: Jp, I: em, S: tm, j: rm, u: nm, q: om, k: im, La: am, Ma: sm, Na: um, Ja: xi, Ka: Si, ta: Ti, db: lm, ab: mm, v: fm, aa: hm, ga: gm, $a: cm, W: bm, Za: ym, Aa: _m, F: dm, U: wm, la: wr, ya: $m, fb: vm, eb: xm, Sa: Ei, Ta: ki, Ga: _n, V: Pi, ja: Oi, Pa: zi, ia: Bi, kb: cf, na: af, lb: lf, oa: of, G: Zm, e: Om, t: km, w: Em, B: Wm, mb: tf, K: qm, x: Dm, pa: rf, Y: sf, ba: ef, nb: Jm, ob: Xm, P: Gm, qa: Ym, pb: Qm, N: Km, Z: nf, d: Pm, A: Bm, m: zm, jb: pf, p: Rm, z: Um, C: Mm, E: Nm, L: Hm, qb: jm, Q: uf, ca: Fm, X: df, rb: Lm, ra: Vm, i: Tm, a: ht, cb: lr } };
  }
  async function be() {
    function a(f3, w) {
      var C = ct = f3.exports;
      f3 = {};
      for (let [P, D] of Object.entries(C)) typeof D == "function" ? (C = Np(D), f3[P] = C) : f3[P] = D;
      return ct = f3, ct = function() {
        var P = ct, D = (K) => (se) => K(se) >>> 0, H = (K) => () => K() >>> 0;
        return (P = Object.assign({}, P)).tb = D(P.tb), P.Xb = H(P.Xb), P.Zb = D(P.Zb), P.lc = D(P.lc), P.mc = H(P.mc), P.qc = D(P.qc), P;
      }(), Lo.push(ct._b), Di = (f3 = ct).tb, Mi = f3.ub, e4._OrtInit = f3.vb, e4._OrtGetLastError = f3.wb, e4._OrtCreateSessionOptions = f3.xb, e4._OrtAppendExecutionProvider = f3.yb, e4._OrtAddFreeDimensionOverride = f3.zb, e4._OrtAddSessionConfigEntry = f3.Ab, e4._OrtReleaseSessionOptions = f3.Bb, e4._OrtCreateSession = f3.Cb, e4._OrtReleaseSession = f3.Db, e4._OrtGetInputOutputCount = f3.Eb, e4._OrtGetInputOutputMetadata = f3.Fb, e4._OrtFree = f3.Gb, e4._OrtCreateTensor = f3.Hb, e4._OrtGetTensorData = f3.Ib, e4._OrtReleaseTensor = f3.Jb, e4._OrtCreateRunOptions = f3.Kb, e4._OrtAddRunConfigEntry = f3.Lb, e4._OrtReleaseRunOptions = f3.Mb, e4._OrtCreateBinding = f3.Nb, e4._OrtBindInput = f3.Ob, e4._OrtBindOutput = f3.Pb, e4._OrtClearBoundOutputs = f3.Qb, e4._OrtReleaseBinding = f3.Rb, e4._OrtRunWithBinding = f3.Sb, e4._OrtRun = f3.Tb, e4._OrtEndProfiling = f3.Ub, e4._JsepOutput = f3.Vb, e4._JsepGetNodeName = f3.Wb, vr = f3.Xb, tt = e4._free = f3.Yb, Qt = e4._malloc = f3.Zb, Bn = f3.ac, Ri = f3.bc, Ui = f3.cc, Ni = f3.dc, Dn = f3.ec, Vi = f3.fc, Li = f3.gc, ce = f3.hc, Yt = f3.ic, Wi = f3.jc, ue = f3.kc, Mn = f3.lc, de = f3.mc, Gi = f3.nc, Rn = f3.oc, Hi = f3.pc, Fi = f3.qc, qi = f3.rc, Un = f3.sc, Ki = f3.tc, ji = f3.uc, Zi = f3.vc, Qi = f3.wc, Yi = f3.xc, Xi = f3.yc, Ji = f3.zc, ea = f3.Ac, ta = f3.Bc, ra = f3.Cc, na = f3.Dc, oa = f3.Ec, ia = f3.Fc, aa = f3.Gc, sa = f3.Hc, ua = f3.Ic, da = f3.Jc, la = f3.Kc, ca = f3.Lc, pa = f3.Mc, ma = f3.Nc, fa = f3.Pc, ha = f3.Qc, ga = f3.$c, ba = f3.ad, ya = f3.fd, _a = f3.jd, wa = f3.kd, va = f3.ld, $a = f3.md, xa = f3.nd, Sa = f3.od, Ta = f3.pd, Ia = f3.qd, Ca = f3.vd, Aa = f3.Td, Ea = f3.Ud, ka = f3.Vd, Pa = f3.Wd, y = w, ct;
    }
    var l, h = G();
    return e4.instantiateWasm ? new Promise((f3) => {
      e4.instantiateWasm(h, (w, C) => {
        f3(a(w, C));
      });
    }) : o ? a(new WebAssembly.Instance(y, G()), y) : (ae ??= e4.locateFile ? e4.locateFile ? e4.locateFile("ort-wasm-simd-threaded.jsep.wasm", m) : m + "ort-wasm-simd-threaded.jsep.wasm" : new URL("ort-wasm-simd-threaded.jsep.wasm", import.meta.url).href, l = await async function(f3) {
      var w = ae;
      if (!g && !z(w)) try {
        var C = fetch(w, { credentials: "same-origin" });
        return await WebAssembly.instantiateStreaming(C, f3);
      } catch (P) {
        E(`wasm streaming compile failed: ${P}`), E("falling back to ArrayBuffer instantiation");
      }
      return async function(P, D) {
        try {
          var H = await async function(K) {
            if (!g) try {
              var se = await u(K);
              return new Uint8Array(se);
            } catch {
            }
            if (K == ae && g) K = new Uint8Array(g);
            else {
              if (!d) throw "both async and sync fetching of the wasm failed";
              K = d(K);
            }
            return K;
          }(P);
          return await WebAssembly.instantiate(H, D);
        } catch (K) {
          E(`failed to asynchronously prepare wasm: ${K}`), M3(K);
        }
      }(w, f3);
    }(h), a(l.instance, l.module));
  }
  class Ee {
    name = "ExitStatus";
    constructor(l) {
      this.message = `Program terminated with exit(${l})`, this.status = l;
    }
  }
  var $e = (a) => {
    a.terminate(), a.onmessage = () => {
    };
  }, Pe = [], he = 0, Te = null, qe = (a) => {
    ft.length == 0 && (Fo(), Ho(ft[0]));
    var l = ft.pop();
    if (!l) return 6;
    jt.push(l), It[a.Rc] = l, l.Rc = a.Rc;
    var h = { Sc: "run", Md: a.Ld, bd: a.bd, Rc: a.Rc };
    return l.postMessage(h, a.rd), 0;
  }, Ne = 0, Se = (a, l, ...h) => {
    var f3, w = 16 * h.length, C = de(), P = Mn(w), D = P >>> 3;
    for (f3 of h) typeof f3 == "bigint" ? ((v(), Z)[D++ >>> 0] = 1n, (v(), Z)[D++ >>> 0] = f3) : ((v(), Z)[D++ >>> 0] = 0n, (v(), Y)[D++ >>> 0] = f3);
    return a = Ui(a, 0, w, P, l), ue(C), a;
  };
  function lr(a) {
    if (o) return Se(0, 1, a);
    if (b = a, !(0 < Ne)) {
      for (var l of jt) $e(l);
      for (l of ft) $e(l);
      ft = [], jt = [], It = {}, A = true;
    }
    c2(0, new Ee(a));
  }
  function Vo(a) {
    if (o) return Se(1, 0, a);
    _n(a);
  }
  var _n = (a) => {
    if (b = a, o) throw Vo(a), "unwind";
    lr(a);
  }, ft = [], jt = [], Lo = [], It = {}, Wo = (a) => {
    var l = a.Rc;
    delete It[l], ft.push(a), jt.splice(jt.indexOf(a), 1), a.Rc = 0, Ni(l);
  };
  function Go() {
    Lo.forEach((a) => a());
  }
  var Ho = (a) => new Promise((l) => {
    a.onmessage = (w) => {
      var C = w.data;
      if (w = C.Sc, C.Zc && C.Zc != vr()) {
        var P = It[C.Zc];
        P ? P.postMessage(C, C.rd) : E(`Internal error! Worker sent a message "${w}" to target pthread ${C.Zc}, but that thread no longer exists!`);
      } else w === "checkMailbox" ? hr() : w === "spawnThread" ? qe(C) : w === "cleanupThread" ? fr(() => {
        Wo(It[C.Nd]);
      }) : w === "loaded" ? (a.loaded = true, l(a)) : C.target === "setimmediate" ? a.postMessage(C) : w === "uncaughtException" ? a.onerror(C.error) : w === "callHandler" ? e4[C.wd](...C.args) : w && E(`worker sent an unknown command ${w}`);
    }, a.onerror = (w) => {
      throw E(`worker sent an error! ${w.filename}:${w.lineno}: ${w.message}`), w;
    };
    var h, f3 = [];
    for (h of []) e4.propertyIsEnumerable(h) && f3.push(h);
    a.postMessage({ Sc: "load", xd: f3, Od: ht, Pd: y });
  });
  function Fo() {
    var a = new Worker((() => {
      let l = URL;
      return import.meta.url > "file:" && import.meta.url < "file;" ? new l("ort.bundle.min.mjs", import.meta.url) : new URL(import.meta.url);
    })(), { type: "module", workerData: "em-pthread", name: "em-pthread" });
    ft.push(a);
  }
  var ht, np = (a, l) => {
    Ne = 0, a = Un(a, l), 0 < Ne ? b = a : Dn(a);
  }, cr = [], pr = 0;
  function op(a) {
    var l = new wn(a >>>= 0);
    return (v(), N)[l.Tc + 12 >>> 0] == 0 && (qo(l, true), pr--), Ko(l, false), cr.push(l), Fi(a);
  }
  var Ut = 0, ip = () => {
    ce(0, 0);
    var a = cr.pop();
    Gi(a.cd), Ut = 0;
  };
  function qo(a, l) {
    l = l ? 1 : 0, (v(), N)[a.Tc + 12 >>> 0] = l;
  }
  function Ko(a, l) {
    l = l ? 1 : 0, (v(), N)[a.Tc + 13 >>> 0] = l;
  }
  class wn {
    constructor(l) {
      this.cd = l, this.Tc = l - 24;
    }
  }
  var vn3 = (a) => {
    var l = Ut;
    if (!l) return Yt(0), 0;
    var h = new wn(l);
    (v(), L)[h.Tc + 16 >>> 2 >>> 0] = l;
    var f3 = (v(), L)[h.Tc + 4 >>> 2 >>> 0];
    if (!f3) return Yt(0), l;
    for (var w of a) {
      if (w === 0 || w === f3) break;
      if (Hi(w, f3, h.Tc + 16)) return Yt(w), l;
    }
    return Yt(f3), l;
  };
  function ap() {
    return vn3([]);
  }
  function sp(a) {
    return vn3([a >>> 0]);
  }
  function up(a, l, h, f3) {
    return vn3([a >>> 0, l >>> 0, h >>> 0, f3 >>> 0]);
  }
  var dp = () => {
    var a = cr.pop();
    a || M3("no exception to throw");
    var l = a.cd;
    throw (v(), N)[a.Tc + 13 >>> 0] == 0 && (cr.push(a), Ko(a, true), qo(a, false), pr++), Rn(l), Ut = l;
  };
  function lp(a, l, h) {
    var f3 = new wn(a >>>= 0);
    throw l >>>= 0, h >>>= 0, (v(), L)[f3.Tc + 16 >>> 2 >>> 0] = 0, (v(), L)[f3.Tc + 4 >>> 2 >>> 0] = l, (v(), L)[f3.Tc + 8 >>> 2 >>> 0] = h, Rn(a), pr++, Ut = a;
  }
  var cp = () => pr;
  function jo(a, l, h, f3) {
    return o ? Se(2, 1, a, l, h, f3) : Zo(a, l, h, f3);
  }
  function Zo(a, l, h, f3) {
    if (a >>>= 0, l >>>= 0, h >>>= 0, f3 >>>= 0, !globalThis.SharedArrayBuffer) return 6;
    var w = [];
    return o && w.length === 0 ? jo(a, l, h, f3) : (a = { Ld: h, Rc: a, bd: f3, rd: w }, o ? (a.Sc = "spawnThread", postMessage(a, w), 0) : qe(a));
  }
  function pp(a) {
    throw Ut ||= a >>> 0, Ut;
  }
  var Qo = globalThis.TextDecoder && new TextDecoder(), Yo = (a, l, h, f3) => {
    if (h = l + h, f3) return h;
    for (; a[l] && !(l >= h); ) ++l;
    return l;
  }, Xo = (a, l = 0, h, f3) => {
    if (16 < (h = Yo(a, l >>>= 0, h, f3)) - l && a.buffer && Qo) return Qo.decode(a.buffer instanceof ArrayBuffer ? a.subarray(l, h) : a.slice(l, h));
    for (f3 = ""; l < h; ) {
      var w = a[l++];
      if (128 & w) {
        var C = 63 & a[l++];
        if ((224 & w) == 192) f3 += String.fromCharCode((31 & w) << 6 | C);
        else {
          var P = 63 & a[l++];
          65536 > (w = (240 & w) == 224 ? (15 & w) << 12 | C << 6 | P : (7 & w) << 18 | C << 12 | P << 6 | 63 & a[l++]) ? f3 += String.fromCharCode(w) : (w -= 65536, f3 += String.fromCharCode(55296 | w >> 10, 56320 | 1023 & w));
        }
      } else f3 += String.fromCharCode(w);
    }
    return f3;
  }, Ae = (a, l, h) => (a >>>= 0) ? Xo((v(), F), a, l, h) : "";
  function Jo(a, l, h) {
    return o ? Se(3, 1, a, l, h) : 0;
  }
  function ei(a, l) {
    if (o) return Se(4, 1, a, l);
  }
  function ti(a, l) {
    if (o) return Se(5, 1, a, l);
  }
  function ri(a, l, h) {
    if (o) return Se(6, 1, a, l, h);
  }
  function ni(a, l, h) {
    return o ? Se(7, 1, a, l, h) : 0;
  }
  function oi(a, l) {
    if (o) return Se(8, 1, a, l);
  }
  function ii(a, l, h) {
    if (o) return Se(9, 1, a, l, h);
  }
  function ai(a, l, h, f3) {
    if (o) return Se(10, 1, a, l, h, f3);
  }
  function si(a, l, h, f3) {
    if (o) return Se(11, 1, a, l, h, f3);
  }
  function ui(a, l, h, f3) {
    if (o) return Se(12, 1, a, l, h, f3);
  }
  function di(a) {
    if (o) return Se(13, 1, a);
  }
  function li(a, l) {
    if (o) return Se(14, 1, a, l);
  }
  function ci(a, l, h) {
    if (o) return Se(15, 1, a, l, h);
  }
  var mp = () => M3(""), Je = (a) => {
    a >>>= 0;
    for (var l = ""; ; ) {
      var h = (v(), F)[a++ >>> 0];
      if (!h) return l;
      l += String.fromCharCode(h);
    }
  }, $n = {}, xn = {}, fp = {}, Nt = class extends Error {
    constructor(a) {
      super(a), this.name = "BindingError";
    }
  };
  function lt(a, l, h = {}) {
    return function(f3, w, C = {}) {
      var P = w.name;
      if (!f3) throw new Nt(`type "${P}" must have a positive integer typeid pointer`);
      if (xn.hasOwnProperty(f3)) {
        if (C.yd) return;
        throw new Nt(`Cannot register type '${P}' twice`);
      }
      xn[f3] = w, delete fp[f3], $n.hasOwnProperty(f3) && (w = $n[f3], delete $n[f3], w.forEach((D) => D()));
    }(a, l, h);
  }
  var pi = (a, l, h) => {
    switch (l) {
      case 1:
        return h ? (f3) => (v(), N)[f3 >>> 0] : (f3) => (v(), F)[f3 >>> 0];
      case 2:
        return h ? (f3) => (v(), q)[f3 >>> 1 >>> 0] : (f3) => (v(), X)[f3 >>> 1 >>> 0];
      case 4:
        return h ? (f3) => (v(), B)[f3 >>> 2 >>> 0] : (f3) => (v(), L)[f3 >>> 2 >>> 0];
      case 8:
        return h ? (f3) => (v(), Z)[f3 >>> 3 >>> 0] : (f3) => (v(), te)[f3 >>> 3 >>> 0];
      default:
        throw new TypeError(`invalid integer width (${l}): ${a}`);
    }
  };
  function hp(a, l, h, f3, w) {
    a >>>= 0, h >>>= 0, l = Je(l >>> 0);
    let C = (P) => P;
    if (f3 = f3 === 0n) {
      let P = 8 * h;
      C = (D) => BigInt.asUintN(P, D), w = C(w);
    }
    lt(a, { name: l, Oc: C, Vc: (P, D) => (typeof D == "number" && (D = BigInt(D)), D), Uc: pi(l, h, !f3), Wc: null });
  }
  function gp(a, l, h, f3) {
    lt(a >>>= 0, { name: l = Je(l >>> 0), Oc: function(w) {
      return !!w;
    }, Vc: function(w, C) {
      return C ? h : f3;
    }, Uc: function(w) {
      return this.Oc((v(), F)[w >>> 0]);
    }, Wc: null });
  }
  var mi = [], Ct = [0, 1, , 1, null, 1, true, 1, false, 1];
  function Sn(a) {
    9 < (a >>>= 0) && --Ct[a + 1] === 0 && (Ct[a] = void 0, mi.push(a));
  }
  var He = (a) => {
    if (!a) throw new Nt(`Cannot use deleted val. handle = ${a}`);
    return Ct[a];
  }, Ke = (a) => {
    switch (a) {
      case void 0:
        return 2;
      case null:
        return 4;
      case true:
        return 6;
      case false:
        return 8;
      default:
        let l = mi.pop() || Ct.length;
        return Ct[l] = a, Ct[l + 1] = 1, l;
    }
  };
  function Tn(a) {
    return this.Oc((v(), L)[a >>> 2 >>> 0]);
  }
  var bp = { name: "emscripten::val", Oc: (a) => {
    var l = He(a);
    return Sn(a), l;
  }, Vc: (a, l) => Ke(l), Uc: Tn, Wc: null };
  function yp(a) {
    return lt(a >>> 0, bp);
  }
  var _p = (a, l) => {
    switch (l) {
      case 4:
        return function(h) {
          return this.Oc((v(), Q)[h >>> 2 >>> 0]);
        };
      case 8:
        return function(h) {
          return this.Oc((v(), Y)[h >>> 3 >>> 0]);
        };
      default:
        throw new TypeError(`invalid float width (${l}): ${a}`);
    }
  };
  function wp(a, l, h) {
    h >>>= 0, lt(a >>>= 0, { name: l = Je(l >>> 0), Oc: (f3) => f3, Vc: (f3, w) => w, Uc: _p(l, h), Wc: null });
  }
  function vp(a, l, h, f3, w) {
    a >>>= 0, h >>>= 0, l = Je(l >>> 0);
    let C = (D) => D;
    if (f3 === 0) {
      var P = 32 - 8 * h;
      C = (D) => D << P >>> P, w = C(w);
    }
    lt(a, { name: l, Oc: C, Vc: (D, H) => H, Uc: pi(l, h, f3 !== 0), Wc: null });
  }
  function $p(a, l, h) {
    function f3(C) {
      var P = (v(), L)[C >>> 2 >>> 0];
      return C = (v(), L)[C + 4 >>> 2 >>> 0], new w((v(), N).buffer, C, P);
    }
    var w = [Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array][l];
    lt(a >>>= 0, { name: h = Je(h >>> 0), Oc: f3, Uc: f3 }, { yd: true });
  }
  var gt = (a, l, h) => {
    var f3 = (v(), F);
    if (l >>>= 0, 0 < h) {
      var w = l;
      h = l + h - 1;
      for (var C = 0; C < a.length; ++C) {
        var P = a.codePointAt(C);
        if (127 >= P) {
          if (l >= h) break;
          f3[l++ >>> 0] = P;
        } else if (2047 >= P) {
          if (l + 1 >= h) break;
          f3[l++ >>> 0] = 192 | P >> 6, f3[l++ >>> 0] = 128 | 63 & P;
        } else if (65535 >= P) {
          if (l + 2 >= h) break;
          f3[l++ >>> 0] = 224 | P >> 12, f3[l++ >>> 0] = 128 | P >> 6 & 63, f3[l++ >>> 0] = 128 | 63 & P;
        } else {
          if (l + 3 >= h) break;
          f3[l++ >>> 0] = 240 | P >> 18, f3[l++ >>> 0] = 128 | P >> 12 & 63, f3[l++ >>> 0] = 128 | P >> 6 & 63, f3[l++ >>> 0] = 128 | 63 & P, C++;
        }
      }
      f3[l >>> 0] = 0, a = l - w;
    } else a = 0;
    return a;
  }, mr = (a) => {
    for (var l = 0, h = 0; h < a.length; ++h) {
      var f3 = a.charCodeAt(h);
      127 >= f3 ? l++ : 2047 >= f3 ? l += 2 : 55296 <= f3 && 57343 >= f3 ? (l += 4, ++h) : l += 3;
    }
    return l;
  };
  function xp(a, l) {
    lt(a >>>= 0, { name: l = Je(l >>> 0), Oc(h) {
      var f3 = (v(), L)[h >>> 2 >>> 0];
      return f3 = Ae(h + 4, f3, true), tt(h), f3;
    }, Vc(h, f3) {
      f3 instanceof ArrayBuffer && (f3 = new Uint8Array(f3));
      var w = typeof f3 == "string";
      if (!(w || ArrayBuffer.isView(f3) && f3.BYTES_PER_ELEMENT == 1)) throw new Nt("Cannot pass non-string to std::string");
      var C = w ? mr(f3) : f3.length, P = Qt(4 + C + 1), D = P + 4;
      return (v(), L)[P >>> 2 >>> 0] = C, w ? gt(f3, D, C + 1) : (v(), F).set(f3, D >>> 0), h !== null && h.push(tt, P), P;
    }, Uc: Tn, Wc(h) {
      tt(h);
    } });
  }
  var fi = globalThis.TextDecoder ? new TextDecoder("utf-16le") : void 0, Sp = (a, l, h) => {
    if (a >>>= 1, 16 < (l = Yo((v(), X), a, l / 2, h)) - a && fi) return fi.decode((v(), X).slice(a, l));
    for (h = ""; a < l; ++a) {
      var f3 = (v(), X)[a >>> 0];
      h += String.fromCharCode(f3);
    }
    return h;
  }, Tp = (a, l, h) => {
    if (h ??= 2147483647, 2 > h) return 0;
    var f3 = l;
    h = (h -= 2) < 2 * a.length ? h / 2 : a.length;
    for (var w = 0; w < h; ++w) {
      var C = a.charCodeAt(w);
      (v(), q)[l >>> 1 >>> 0] = C, l += 2;
    }
    return (v(), q)[l >>> 1 >>> 0] = 0, l - f3;
  }, Ip = (a) => 2 * a.length, Cp = (a, l, h) => {
    var f3 = "";
    a >>>= 2;
    for (var w = 0; !(w >= l / 4); w++) {
      var C = (v(), L)[a + w >>> 0];
      if (!C && !h) break;
      f3 += String.fromCodePoint(C);
    }
    return f3;
  }, Ap = (a, l, h) => {
    if (l >>>= 0, h ??= 2147483647, 4 > h) return 0;
    var f3 = l;
    h = f3 + h - 4;
    for (var w = 0; w < a.length; ++w) {
      var C = a.codePointAt(w);
      if (65535 < C && w++, (v(), B)[l >>> 2 >>> 0] = C, (l += 4) + 4 > h) break;
    }
    return (v(), B)[l >>> 2 >>> 0] = 0, l - f3;
  }, Ep = (a) => {
    for (var l = 0, h = 0; h < a.length; ++h) 65535 < a.codePointAt(h) && h++, l += 4;
    return l;
  };
  function kp(a, l, h) {
    if (a >>>= 0, l >>>= 0, h = Je(h >>>= 0), l === 2) var f3 = Sp, w = Tp, C = Ip;
    else f3 = Cp, w = Ap, C = Ep;
    lt(a, { name: h, Oc: (P) => {
      var D = (v(), L)[P >>> 2 >>> 0];
      return D = f3(P + 4, D * l, true), tt(P), D;
    }, Vc: (P, D) => {
      if (typeof D != "string") throw new Nt(`Cannot pass non-string to C++ string type ${h}`);
      var H = C(D), K = Qt(4 + H + l);
      return (v(), L)[K >>> 2 >>> 0] = H / l, w(D, K + 4, H + l), P !== null && P.push(tt, K), K;
    }, Uc: Tn, Wc(P) {
      tt(P);
    } });
  }
  function Pp(a, l) {
    lt(a >>>= 0, { zd: true, name: l = Je(l >>> 0), Oc: () => {
    }, Vc: () => {
    } });
  }
  function Op(a) {
    Bn(a >>> 0, !n, 1, !r, 131072, false), Go();
  }
  var fr = (a) => {
    if (!A) try {
      if (a(), !(0 < Ne)) try {
        o ? vr() && Dn(b) : _n(b);
      } catch (l) {
        l instanceof Ee || l == "unwind" || c2(0, l);
      }
    } catch (l) {
      l instanceof Ee || l == "unwind" || c2(0, l);
    }
  }, zp = !Atomics.waitAsync || globalThis.navigator?.userAgent && 91 > Number((navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./) || [])[2]);
  function In(a) {
    a >>>= 0, zp || (Atomics.waitAsync((v(), B), a >>> 2, a).value.then(hr), a += 128, Atomics.store((v(), B), a >>> 2, 1));
  }
  var hr = () => fr(() => {
    var a = vr();
    a && (In(a), Li());
  });
  function Bp(a, l) {
    (a >>>= 0) == l >>> 0 ? setTimeout(hr) : o ? postMessage({ Zc: a, Sc: "checkMailbox" }) : (a = It[a]) && a.postMessage({ Sc: "checkMailbox" });
  }
  var Cn = [];
  function Dp(a, l, h, f3, w) {
    for (l >>>= 0, w >>>= 0, Cn.length = 0, h = w >>> 3, f3 = w + f3 >>> 3; h < f3; ) {
      var C;
      C = (v(), Z)[h++ >>> 0] ? (v(), Z)[h++ >>> 0] : (v(), Y)[h++ >>> 0], Cn.push(C);
    }
    return (l ? Nn[l] : Im[a])(...Cn);
  }
  var Mp = () => {
    Ne = 0;
  };
  function Rp(a) {
    a >>>= 0, o ? postMessage({ Sc: "cleanupThread", Nd: a }) : Wo(It[a]);
  }
  function Up(a) {
  }
  var gr = (a) => {
    try {
      a();
    } catch (l) {
      M3(l);
    }
  };
  function Np(a) {
    var l = (...h) => {
      br.push(a);
      try {
        return a(...h);
      } finally {
        A || (br.pop(), et && bt === 1 && br.length === 0 && (bt = 0, Ne += 1, gr(Ea), typeof Fibers < "u" && Fibers.Zd()));
      }
    };
    return bi.set(a, l), l;
  }
  var bt = 0, et = null, hi = 0, br = [], An = /* @__PURE__ */ new Map(), gi = /* @__PURE__ */ new Map(), bi = /* @__PURE__ */ new Map(), Vp = 0, En = null, Lp = [], yi = (a) => function(l) {
    if (!A) {
      if (bt === 0) {
        var h = false, f3 = false;
        l((w = 0) => {
          if (!A && (hi = w, h = true, f3)) {
            bt = 2, gr(() => ka(et)), typeof MainLoop < "u" && MainLoop.ud && MainLoop.resume(), w = false;
            try {
              var C = function() {
                var H = (v(), B)[et + 8 >>> 2 >>> 0];
                return H = gi.get(H), H = bi.get(H), --Ne, H();
              }();
            } catch (H) {
              C = H, w = true;
            }
            var P = false;
            if (!et) {
              var D = En;
              D && (En = null, (w ? D.reject : D.resolve)(C), P = true);
            }
            if (w && !P) throw C;
          }
        }), f3 = true, h || (bt = 1, et = function() {
          var w = Qt(65548), C = w + 12;
          if ((v(), L)[w >>> 2 >>> 0] = C, (v(), L)[w + 4 >>> 2 >>> 0] = C + 65536, C = br[0], !An.has(C)) {
            var P = Vp++;
            An.set(C, P), gi.set(P, C);
          }
          return C = An.get(C), (v(), B)[w + 8 >>> 2 >>> 0] = C, w;
        }(), typeof MainLoop < "u" && MainLoop.ud && MainLoop.pause(), gr(() => Aa(et)));
      } else bt === 2 ? (bt = 0, gr(Pa), tt(et), et = null, Lp.forEach(fr)) : M3(`invalid state: ${bt}`);
      return hi;
    }
  }((l) => {
    a().then(l);
  });
  function Wp(a) {
    return a >>>= 0, yi(async () => {
      var l = await He(a);
      return Ke(l);
    });
  }
  var kn = [], Gp = (a) => {
    var l = kn.length;
    return kn.push(a), l;
  }, Hp = (a, l) => {
    for (var h = Array(a), f3 = 0; f3 < a; ++f3) {
      var w = f3, C = (v(), L)[l + 4 * f3 >>> 2 >>> 0], P = xn[C];
      if (P === void 0) throw a = `parameter ${f3}`, C = Di(C), l = Je(C), tt(C), new Nt(`${a} has unknown type ${l}`);
      h[w] = P;
    }
    return h;
  }, Fp = (a, l, h) => {
    var f3 = [];
    return a = a(f3, h), f3.length && ((v(), L)[l >>> 2 >>> 0] = Ke(f3)), a;
  }, qp = {}, yr = (a) => {
    var l = qp[a];
    return l === void 0 ? Je(a) : l;
  };
  function Kp(a, l, h) {
    var [f3, ...w] = Hp(a, l >>> 0);
    l = f3.Vc.bind(f3);
    var C = w.map((H) => H.Uc.bind(H));
    a--;
    var P = { toValue: He };
    switch (a = C.map((H, K) => {
      var se = `argFromPtr${K}`;
      return P[se] = H, `${se}(args${K ? "+" + 8 * K : ""})`;
    }), h) {
      case 0:
        var D = "toValue(handle)";
        break;
      case 2:
        D = "new (toValue(handle))";
        break;
      case 3:
        D = "";
        break;
      case 1:
        P.getStringOrSymbol = yr, D = "toValue(handle)[getStringOrSymbol(methodName)]";
    }
    return D += `(${a})`, f3.zd || (P.toReturnWire = l, P.emval_returnValue = Fp, D = `return emval_returnValue(toReturnWire, destructorsRef, ${D})`), D = `return function (handle, methodName, destructorsRef, args) {
  ${D}
  }`, h = new Function(Object.keys(P), D)(...Object.values(P)), D = `methodCaller<(${w.map((H) => H.name)}) => ${f3.name}>`, Gp(Object.defineProperty(h, "name", { value: D }));
  }
  function jp(a, l) {
    return l >>>= 0, (a = He(a >>> 0)) == He(l);
  }
  function Zp(a) {
    return (a >>>= 0) ? (a = yr(a), Ke(globalThis[a])) : Ke(globalThis);
  }
  function Qp(a) {
    return a = yr(a >>> 0), Ke(e4[a]);
  }
  function Yp(a, l) {
    return l >>>= 0, a = He(a >>> 0), l = He(l), Ke(a[l]);
  }
  function Xp(a) {
    9 < (a >>>= 0) && (Ct[a + 1] += 1);
  }
  function _i2(a, l, h, f3, w) {
    return kn[a >>> 0](l >>> 0, h >>> 0, f3 >>> 0, w >>> 0);
  }
  function Jp(a, l, h, f3, w) {
    return _i2(a >>> 0, l >>> 0, h >>> 0, f3 >>> 0, w >>> 0);
  }
  function em() {
    return Ke([]);
  }
  function tm(a) {
    a = He(a >>> 0);
    for (var l = Array(a.length), h = 0; h < a.length; h++) l[h] = a[h];
    return Ke(l);
  }
  function rm(a) {
    return Ke(yr(a >>> 0));
  }
  function nm() {
    return Ke({});
  }
  function om(a) {
    for (var l = He(a >>>= 0); l.length; ) {
      var h = l.pop();
      l.pop()(h);
    }
    Sn(a);
  }
  function im(a, l, h) {
    l >>>= 0, h >>>= 0, a = He(a >>> 0), l = He(l), h = He(h), a[l] = h;
  }
  function am(a, l) {
    a = -9007199254740992 > a || 9007199254740992 < a ? NaN : Number(a), l >>>= 0, a = new Date(1e3 * a), (v(), B)[l >>> 2 >>> 0] = a.getUTCSeconds(), (v(), B)[l + 4 >>> 2 >>> 0] = a.getUTCMinutes(), (v(), B)[l + 8 >>> 2 >>> 0] = a.getUTCHours(), (v(), B)[l + 12 >>> 2 >>> 0] = a.getUTCDate(), (v(), B)[l + 16 >>> 2 >>> 0] = a.getUTCMonth(), (v(), B)[l + 20 >>> 2 >>> 0] = a.getUTCFullYear() - 1900, (v(), B)[l + 24 >>> 2 >>> 0] = a.getUTCDay(), a = (a.getTime() - Date.UTC(a.getUTCFullYear(), 0, 1, 0, 0, 0, 0)) / 864e5 | 0, (v(), B)[l + 28 >>> 2 >>> 0] = a;
  }
  var wi = (a) => a % 4 == 0 && (a % 100 != 0 || a % 400 == 0), vi = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335], $i = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  function sm(a, l) {
    a = -9007199254740992 > a || 9007199254740992 < a ? NaN : Number(a), l >>>= 0, a = new Date(1e3 * a), (v(), B)[l >>> 2 >>> 0] = a.getSeconds(), (v(), B)[l + 4 >>> 2 >>> 0] = a.getMinutes(), (v(), B)[l + 8 >>> 2 >>> 0] = a.getHours(), (v(), B)[l + 12 >>> 2 >>> 0] = a.getDate(), (v(), B)[l + 16 >>> 2 >>> 0] = a.getMonth(), (v(), B)[l + 20 >>> 2 >>> 0] = a.getFullYear() - 1900, (v(), B)[l + 24 >>> 2 >>> 0] = a.getDay();
    var h = (wi(a.getFullYear()) ? vi : $i)[a.getMonth()] + a.getDate() - 1 | 0;
    (v(), B)[l + 28 >>> 2 >>> 0] = h, (v(), B)[l + 36 >>> 2 >>> 0] = -60 * a.getTimezoneOffset(), h = new Date(a.getFullYear(), 6, 1).getTimezoneOffset();
    var f3 = new Date(a.getFullYear(), 0, 1).getTimezoneOffset();
    a = 0 | (h != f3 && a.getTimezoneOffset() == Math.min(f3, h)), (v(), B)[l + 32 >>> 2 >>> 0] = a;
  }
  function um(a) {
    a >>>= 0;
    var l = new Date((v(), B)[a + 20 >>> 2 >>> 0] + 1900, (v(), B)[a + 16 >>> 2 >>> 0], (v(), B)[a + 12 >>> 2 >>> 0], (v(), B)[a + 8 >>> 2 >>> 0], (v(), B)[a + 4 >>> 2 >>> 0], (v(), B)[a >>> 2 >>> 0], 0), h = (v(), B)[a + 32 >>> 2 >>> 0], f3 = l.getTimezoneOffset(), w = new Date(l.getFullYear(), 6, 1).getTimezoneOffset(), C = new Date(l.getFullYear(), 0, 1).getTimezoneOffset(), P = Math.min(C, w);
    return 0 > h ? (v(), B)[a + 32 >>> 2 >>> 0] = +(w != C && P == f3) : 0 < h != (P == f3) && (w = Math.max(C, w), l.setTime(l.getTime() + 6e4 * ((0 < h ? P : w) - f3))), (v(), B)[a + 24 >>> 2 >>> 0] = l.getDay(), h = (wi(l.getFullYear()) ? vi : $i)[l.getMonth()] + l.getDate() - 1 | 0, (v(), B)[a + 28 >>> 2 >>> 0] = h, (v(), B)[a >>> 2 >>> 0] = l.getSeconds(), (v(), B)[a + 4 >>> 2 >>> 0] = l.getMinutes(), (v(), B)[a + 8 >>> 2 >>> 0] = l.getHours(), (v(), B)[a + 12 >>> 2 >>> 0] = l.getDate(), (v(), B)[a + 16 >>> 2 >>> 0] = l.getMonth(), (v(), B)[a + 20 >>> 2 >>> 0] = l.getYear(), a = l.getTime(), BigInt(isNaN(a) ? -1 : a / 1e3);
  }
  function xi(a, l, h, f3, w, C, P) {
    return o ? Se(16, 1, a, l, h, f3, w, C, P) : -52;
  }
  function Si(a, l, h, f3, w, C) {
    if (o) return Se(17, 1, a, l, h, f3, w, C);
  }
  var Zt = {}, dm = () => performance.timeOrigin + performance.now();
  function Ti(a, l) {
    if (o) return Se(18, 1, a, l);
    if (Zt[a] && (clearTimeout(Zt[a].id), delete Zt[a]), !l) return 0;
    var h = setTimeout(() => {
      delete Zt[a], fr(() => Vi(a, performance.timeOrigin + performance.now()));
    }, l);
    return Zt[a] = { id: h, Yd: l }, 0;
  }
  function lm(a, l, h, f3) {
    a >>>= 0, l >>>= 0, h >>>= 0, f3 >>>= 0;
    var w = (/* @__PURE__ */ new Date()).getFullYear(), C = new Date(w, 0, 1).getTimezoneOffset();
    w = new Date(w, 6, 1).getTimezoneOffset();
    var P = Math.max(C, w);
    (v(), L)[a >>> 2 >>> 0] = 60 * P, (v(), B)[l >>> 2 >>> 0] = +(C != w), a = (l = (D) => {
      var H = Math.abs(D);
      return `UTC${0 <= D ? "-" : "+"}${String(Math.floor(H / 60)).padStart(2, "0")}${String(H % 60).padStart(2, "0")}`;
    })(C), l = l(w), w < C ? (gt(a, h, 17), gt(l, f3, 17)) : (gt(a, f3, 17), gt(l, h, 17));
  }
  var cm = () => Date.now(), pm = 1;
  function mm(a, l, h) {
    if (h >>>= 0, !(0 <= a && 3 >= a)) return 28;
    if (a === 0) a = Date.now();
    else {
      if (!pm) return 52;
      a = performance.timeOrigin + performance.now();
    }
    return a = Math.round(1e6 * a), (v(), Z)[h >>> 3 >>> 0] = BigInt(a), 0;
  }
  var Pn = [], Ii = (a, l) => {
    Pn.length = 0;
    for (var h; h = (v(), F)[a++ >>> 0]; ) {
      var f3 = h != 105;
      l += (f3 &= h != 112) && l % 8 ? 4 : 0, Pn.push(h == 112 ? (v(), L)[l >>> 2 >>> 0] : h == 106 ? (v(), Z)[l >>> 3 >>> 0] : h == 105 ? (v(), B)[l >>> 2 >>> 0] : (v(), Y)[l >>> 3 >>> 0]), l += f3 ? 8 : 4;
    }
    return Pn;
  };
  function fm(a, l, h) {
    return a >>>= 0, l = Ii(l >>> 0, h >>> 0), Nn[a](...l);
  }
  function hm(a, l, h) {
    return a >>>= 0, l = Ii(l >>> 0, h >>> 0), Nn[a](...l);
  }
  var gm = () => {
  };
  function bm(a, l) {
    return E(Ae(a >>> 0, l >>> 0));
  }
  var ym = () => {
    throw Ne += 1, "unwind";
  };
  function _m() {
    return 4294901760;
  }
  var wm = () => navigator.hardwareConcurrency, At = {}, _r = (a) => {
    var l;
    return (l = /\bwasm-function\[\d+\]:(0x[0-9a-f]+)/.exec(a)) ? +l[1] : (l = /:(\d+):\d+(?:\)|$)/.exec(a)) ? 2147483648 | +l[1] : 0;
  }, Ci = (a) => {
    for (var l of a) (a = _r(l)) && (At[a] = l);
  };
  function vm() {
    var a = Error().stack.toString().split(`
`);
    return a[0] == "Error" && a.shift(), Ci(a), At.gd = _r(a[3]), At.Jd = a, At.gd;
  }
  function wr(a) {
    if (!(a = At[a >>> 0])) return 0;
    var l;
    if (l = /^\s+at .*\.wasm\.(.*) \(.*\)$/.exec(a)) a = l[1];
    else if (l = /^\s+at (.*) \(.*\)$/.exec(a)) a = l[1];
    else {
      if (!(l = /^(.+?)@/.exec(a))) return 0;
      a = l[1];
    }
    tt(wr.hd ?? 0), l = mr(a) + 1;
    var h = Qt(l);
    return h && gt(a, h, l), wr.hd = h, wr.hd;
  }
  function $m(a) {
    a >>>= 0;
    var l = (v(), F).length;
    if (a <= l || 4294901760 < a) return false;
    for (var h = 1; 4 >= h; h *= 2) {
      var f3 = l * (1 + 0.2 / h);
      f3 = Math.min(f3, a + 100663296);
      e: {
        f3 = (Math.min(4294901760, 65536 * Math.ceil(Math.max(a, f3) / 65536)) - ht.buffer.byteLength + 65535) / 65536 | 0;
        try {
          ht.grow(f3), Me();
          var w = 1;
          break e;
        } catch {
        }
        w = void 0;
      }
      if (w) return true;
    }
    return false;
  }
  function xm(a, l, h) {
    if (a >>>= 0, l >>>= 0, At.gd == a) var f3 = At.Jd;
    else (f3 = Error().stack.toString().split(`
`))[0] == "Error" && f3.shift(), Ci(f3);
    for (var w = 3; f3[w] && _r(f3[w]) != a; ) ++w;
    for (a = 0; a < h && f3[a + w]; ++a) (v(), B)[l + 4 * a >>> 2 >>> 0] = _r(f3[a + w]);
    return a;
  }
  var On, zn = {}, Ai = () => {
    if (!On) {
      var a, l = { USER: "web_user", LOGNAME: "web_user", PATH: "/", PWD: "/", HOME: "/home/web_user", LANG: (globalThis.navigator?.language ?? "C").replace("-", "_") + ".UTF-8", _: "./this.program" };
      for (a in zn) zn[a] === void 0 ? delete l[a] : l[a] = zn[a];
      var h = [];
      for (a in l) h.push(`${a}=${l[a]}`);
      On = h;
    }
    return On;
  };
  function Ei(a, l) {
    if (o) return Se(19, 1, a, l);
    a >>>= 0, l >>>= 0;
    var h, f3 = 0, w = 0;
    for (h of Ai()) {
      var C = l + f3;
      (v(), L)[a + w >>> 2 >>> 0] = C, f3 += gt(h, C, 1 / 0) + 1, w += 4;
    }
    return 0;
  }
  function ki(a, l) {
    if (o) return Se(20, 1, a, l);
    a >>>= 0, l >>>= 0;
    var h = Ai();
    for (var f3 of ((v(), L)[a >>> 2 >>> 0] = h.length, a = 0, h)) a += mr(f3) + 1;
    return (v(), L)[l >>> 2 >>> 0] = a, 0;
  }
  function Pi(a) {
    return o ? Se(21, 1, a) : 52;
  }
  function Oi(a, l, h, f3) {
    return o ? Se(22, 1, a, l, h, f3) : 52;
  }
  function zi(a, l, h, f3) {
    return o ? Se(23, 1, a, l, h, f3) : 70;
  }
  var Sm = [null, [], []];
  function Bi(a, l, h, f3) {
    if (o) return Se(24, 1, a, l, h, f3);
    l >>>= 0, h >>>= 0, f3 >>>= 0;
    for (var w = 0, C = 0; C < h; C++) {
      var P = (v(), L)[l >>> 2 >>> 0], D = (v(), L)[l + 4 >>> 2 >>> 0];
      l += 8;
      for (var H = 0; H < D; H++) {
        var K = a, se = (v(), F)[P + H >>> 0], pe = Sm[K];
        se === 0 || se === 10 ? ((K === 1 ? I : E)(Xo(pe)), pe.length = 0) : pe.push(se);
      }
      w += D;
    }
    return (v(), L)[f3 >>> 2 >>> 0] = w, 0;
  }
  function Tm(a) {
    return a >>> 0;
  }
  o || function() {
    for (var a = e4.numThreads - 1; a--; ) Fo();
    Pe.push(async () => {
      var l = async function() {
        if (!o) return Promise.all(ft.map(Ho));
      }();
      he++, await l, --he == 0 && Te && (l = Te, Te = null, l());
    });
  }(), o || (ht = new WebAssembly.Memory({ initial: 256, maximum: 65536, shared: true }), Me()), e4.wasmBinary && (g = e4.wasmBinary), e4.stackSave = () => de(), e4.stackRestore = (a) => ue(a), e4.stackAlloc = (a) => Mn(a), e4.setValue = function(a, l, h = "i8") {
    switch (h.endsWith("*") && (h = "*"), h) {
      case "i1":
      case "i8":
        (v(), N)[a >>> 0] = l;
        break;
      case "i16":
        (v(), q)[a >>> 1 >>> 0] = l;
        break;
      case "i32":
        (v(), B)[a >>> 2 >>> 0] = l;
        break;
      case "i64":
        (v(), Z)[a >>> 3 >>> 0] = BigInt(l);
        break;
      case "float":
        (v(), Q)[a >>> 2 >>> 0] = l;
        break;
      case "double":
        (v(), Y)[a >>> 3 >>> 0] = l;
        break;
      case "*":
        (v(), L)[a >>> 2 >>> 0] = l;
        break;
      default:
        M3(`invalid type for setValue: ${h}`);
    }
  }, e4.getValue = function(a, l = "i8") {
    switch (l.endsWith("*") && (l = "*"), l) {
      case "i1":
      case "i8":
        return (v(), N)[a >>> 0];
      case "i16":
        return (v(), q)[a >>> 1 >>> 0];
      case "i32":
        return (v(), B)[a >>> 2 >>> 0];
      case "i64":
        return (v(), Z)[a >>> 3 >>> 0];
      case "float":
        return (v(), Q)[a >>> 2 >>> 0];
      case "double":
        return (v(), Y)[a >>> 3 >>> 0];
      case "*":
        return (v(), L)[a >>> 2 >>> 0];
      default:
        M3(`invalid type for getValue: ${l}`);
    }
  }, e4.UTF8ToString = Ae, e4.stringToUTF8 = gt, e4.lengthBytesUTF8 = mr;
  var Di, Mi, vr, tt, Qt, Bn, Ri, Ui, Ni, Dn, Vi, Li, ce, Yt, Wi, ue, Mn, de, Gi, Rn, Hi, Fi, qi, Un, Ki, ji, Zi, Qi, Yi, Xi, Ji, ea, ta, ra, na, oa, ia, aa, sa, ua, da, la, ca, pa, ma, fa, ha, ga, ba, ya, _a, wa, va, $a, xa, Sa, Ta, Ia, Ca, Aa, Ea, ka, Pa, ct, Im = [lr, Vo, jo, Jo, ei, ti, ri, ni, oi, ii, ai, si, ui, di, li, ci, xi, Si, Ti, Ei, ki, Pi, Oi, zi, Bi], Nn = { 1003524: (a, l, h, f3, w) => {
    if (e4 === void 0 || !e4.Xc) return 1;
    if ((a = Ae(Number(a >>> 0))).startsWith("./") && (a = a.substring(2)), !(a = e4.Xc.get(a))) return 2;
    if (l = Number(l >>> 0), h = Number(h >>> 0), f3 = Number(f3 >>> 0), l + h > a.byteLength) return 3;
    try {
      let C = a.subarray(l, l + h);
      switch (w) {
        case 0:
          (v(), F).set(C, f3 >>> 0);
          break;
        case 1:
          e4.Qd ? e4.Qd(f3, C) : e4.Id(f3, C);
          break;
        default:
          return 4;
      }
      return 0;
    } catch {
      return 4;
    }
  }, 1004348: (a, l, h) => {
    e4.td(a, (v(), F).subarray(l >>> 0, l + h >>> 0));
  }, 1004412: () => e4.Sd(), 1004454: (a) => {
    e4.sd(a);
  }, 1004491: () => {
    e4.Bd();
  }, 1004522: () => {
    e4.Cd();
  }, 1004551: () => {
    e4.Gd();
  }, 1004576: (a) => e4.Ad(a), 1004609: (a) => e4.Ed(a), 1004641: (a, l, h) => {
    e4.ed(Number(a), Number(l), Number(h), true);
  }, 1004704: (a, l, h) => {
    e4.ed(Number(a), Number(l), Number(h));
  }, 1004761: () => typeof wasmOffsetConverter < "u", 1004818: (a) => {
    e4.$b("Abs", a, void 0);
  }, 1004869: (a) => {
    e4.$b("Neg", a, void 0);
  }, 1004920: (a) => {
    e4.$b("Floor", a, void 0);
  }, 1004973: (a) => {
    e4.$b("Ceil", a, void 0);
  }, 1005025: (a) => {
    e4.$b("Reciprocal", a, void 0);
  }, 1005083: (a) => {
    e4.$b("Sqrt", a, void 0);
  }, 1005135: (a) => {
    e4.$b("Exp", a, void 0);
  }, 1005186: (a) => {
    e4.$b("Erf", a, void 0);
  }, 1005237: (a) => {
    e4.$b("Sigmoid", a, void 0);
  }, 1005292: (a, l, h) => {
    e4.$b("HardSigmoid", a, { alpha: l, beta: h });
  }, 1005371: (a) => {
    e4.$b("Log", a, void 0);
  }, 1005422: (a) => {
    e4.$b("Sin", a, void 0);
  }, 1005473: (a) => {
    e4.$b("Cos", a, void 0);
  }, 1005524: (a) => {
    e4.$b("Tan", a, void 0);
  }, 1005575: (a) => {
    e4.$b("Asin", a, void 0);
  }, 1005627: (a) => {
    e4.$b("Acos", a, void 0);
  }, 1005679: (a) => {
    e4.$b("Atan", a, void 0);
  }, 1005731: (a) => {
    e4.$b("Sinh", a, void 0);
  }, 1005783: (a) => {
    e4.$b("Cosh", a, void 0);
  }, 1005835: (a) => {
    e4.$b("Asinh", a, void 0);
  }, 1005888: (a) => {
    e4.$b("Acosh", a, void 0);
  }, 1005941: (a) => {
    e4.$b("Atanh", a, void 0);
  }, 1005994: (a) => {
    e4.$b("Tanh", a, void 0);
  }, 1006046: (a) => {
    e4.$b("Not", a, void 0);
  }, 1006097: (a, l, h) => {
    e4.$b("Clip", a, { min: l, max: h });
  }, 1006166: (a) => {
    e4.$b("Clip", a, void 0);
  }, 1006218: (a, l) => {
    e4.$b("Elu", a, { alpha: l });
  }, 1006276: (a) => {
    e4.$b("Gelu", a, void 0);
  }, 1006328: (a) => {
    e4.$b("Relu", a, void 0);
  }, 1006380: (a, l) => {
    e4.$b("LeakyRelu", a, { alpha: l });
  }, 1006444: (a, l) => {
    e4.$b("ThresholdedRelu", a, { alpha: l });
  }, 1006514: (a, l) => {
    e4.$b("Cast", a, { to: l });
  }, 1006572: (a) => {
    e4.$b("Add", a, void 0);
  }, 1006623: (a) => {
    e4.$b("Sub", a, void 0);
  }, 1006674: (a) => {
    e4.$b("Mul", a, void 0);
  }, 1006725: (a) => {
    e4.$b("Div", a, void 0);
  }, 1006776: (a) => {
    e4.$b("Pow", a, void 0);
  }, 1006827: (a) => {
    e4.$b("Equal", a, void 0);
  }, 1006880: (a) => {
    e4.$b("Greater", a, void 0);
  }, 1006935: (a) => {
    e4.$b("GreaterOrEqual", a, void 0);
  }, 1006997: (a) => {
    e4.$b("Less", a, void 0);
  }, 1007049: (a) => {
    e4.$b("LessOrEqual", a, void 0);
  }, 1007108: (a, l, h, f3, w) => {
    e4.$b("ReduceMean", a, { keepDims: !!l, noopWithEmptyAxes: !!h, axes: f3 ? Array.from((v(), B).subarray(Number(f3) >>> 0, Number(w) >>> 0)) : [] });
  }, 1007283: (a, l, h, f3, w) => {
    e4.$b("ReduceMax", a, { keepDims: !!l, noopWithEmptyAxes: !!h, axes: f3 ? Array.from((v(), B).subarray(Number(f3) >>> 0, Number(w) >>> 0)) : [] });
  }, 1007457: (a, l, h, f3, w) => {
    e4.$b("ReduceMin", a, { keepDims: !!l, noopWithEmptyAxes: !!h, axes: f3 ? Array.from((v(), B).subarray(Number(f3) >>> 0, Number(w) >>> 0)) : [] });
  }, 1007631: (a, l, h, f3, w) => {
    e4.$b("ReduceProd", a, { keepDims: !!l, noopWithEmptyAxes: !!h, axes: f3 ? Array.from((v(), B).subarray(Number(f3) >>> 0, Number(w) >>> 0)) : [] });
  }, 1007806: (a, l, h, f3, w) => {
    e4.$b("ReduceSum", a, { keepDims: !!l, noopWithEmptyAxes: !!h, axes: f3 ? Array.from((v(), B).subarray(Number(f3) >>> 0, Number(w) >>> 0)) : [] });
  }, 1007980: (a, l, h, f3, w) => {
    e4.$b("ReduceL1", a, { keepDims: !!l, noopWithEmptyAxes: !!h, axes: f3 ? Array.from((v(), B).subarray(Number(f3) >>> 0, Number(w) >>> 0)) : [] });
  }, 1008153: (a, l, h, f3, w) => {
    e4.$b("ReduceL2", a, { keepDims: !!l, noopWithEmptyAxes: !!h, axes: f3 ? Array.from((v(), B).subarray(Number(f3) >>> 0, Number(w) >>> 0)) : [] });
  }, 1008326: (a, l, h, f3, w) => {
    e4.$b("ReduceLogSum", a, { keepDims: !!l, noopWithEmptyAxes: !!h, axes: f3 ? Array.from((v(), B).subarray(Number(f3) >>> 0, Number(w) >>> 0)) : [] });
  }, 1008503: (a, l, h, f3, w) => {
    e4.$b("ReduceSumSquare", a, { keepDims: !!l, noopWithEmptyAxes: !!h, axes: f3 ? Array.from((v(), B).subarray(Number(f3) >>> 0, Number(w) >>> 0)) : [] });
  }, 1008683: (a, l, h, f3, w) => {
    e4.$b("ReduceLogSumExp", a, { keepDims: !!l, noopWithEmptyAxes: !!h, axes: f3 ? Array.from((v(), B).subarray(Number(f3) >>> 0, Number(w) >>> 0)) : [] });
  }, 1008863: (a) => {
    e4.$b("Where", a, void 0);
  }, 1008916: (a, l, h) => {
    e4.$b("Transpose", a, { perm: l ? Array.from((v(), B).subarray(Number(l) >>> 0, Number(h) >>> 0)) : [] });
  }, 1009040: (a, l, h, f3) => {
    e4.$b("DepthToSpace", a, { blocksize: l, mode: Ae(h), format: f3 ? "NHWC" : "NCHW" });
  }, 1009173: (a, l, h, f3) => {
    e4.$b("DepthToSpace", a, { blocksize: l, mode: Ae(h), format: f3 ? "NHWC" : "NCHW" });
  }, 1009306: (a, l, h, f3, w, C, P, D, H, K, se, pe, xe, Ie, yt) => {
    e4.$b("ConvTranspose", a, { format: H ? "NHWC" : "NCHW", autoPad: l, dilations: [h], group: f3, kernelShape: [w], pads: [C, P], strides: [D], wIsConst: () => !!(v(), N)[K >>> 0], outputPadding: se ? Array.from((v(), B).subarray(Number(se) >>> 0, Number(pe) >>> 0)) : [], outputShape: xe ? Array.from((v(), B).subarray(Number(xe) >>> 0, Number(Ie) >>> 0)) : [], activation: Ae(yt) });
  }, 1009739: (a, l, h, f3, w, C, P, D, H, K, se, pe, xe, Ie) => {
    e4.$b("ConvTranspose", a, { format: D ? "NHWC" : "NCHW", autoPad: l, dilations: Array.from((v(), B).subarray(Number(h) >>> 0, (Number(h) >>> 0) + 2 >>> 0)), group: f3, kernelShape: Array.from((v(), B).subarray(Number(w) >>> 0, (Number(w) >>> 0) + 2 >>> 0)), pads: Array.from((v(), B).subarray(Number(C) >>> 0, (Number(C) >>> 0) + 4 >>> 0)), strides: Array.from((v(), B).subarray(Number(P) >>> 0, (Number(P) >>> 0) + 2 >>> 0)), wIsConst: () => !!(v(), N)[H >>> 0], outputPadding: K ? Array.from((v(), B).subarray(Number(K) >>> 0, Number(se) >>> 0)) : [], outputShape: pe ? Array.from((v(), B).subarray(Number(pe) >>> 0, Number(xe) >>> 0)) : [], activation: Ae(Ie) });
  }, 1010400: (a, l, h, f3, w, C, P, D, H, K, se, pe, xe, Ie, yt) => {
    e4.$b("ConvTranspose", a, { format: H ? "NHWC" : "NCHW", autoPad: l, dilations: [h], group: f3, kernelShape: [w], pads: [C, P], strides: [D], wIsConst: () => !!(v(), N)[K >>> 0], outputPadding: se ? Array.from((v(), B).subarray(Number(se) >>> 0, Number(pe) >>> 0)) : [], outputShape: xe ? Array.from((v(), B).subarray(Number(xe) >>> 0, Number(Ie) >>> 0)) : [], activation: Ae(yt) });
  }, 1010833: (a, l, h, f3, w, C, P, D, H, K, se, pe, xe, Ie) => {
    e4.$b("ConvTranspose", a, { format: D ? "NHWC" : "NCHW", autoPad: l, dilations: Array.from((v(), B).subarray(Number(h) >>> 0, (Number(h) >>> 0) + 2 >>> 0)), group: f3, kernelShape: Array.from((v(), B).subarray(Number(w) >>> 0, (Number(w) >>> 0) + 2 >>> 0)), pads: Array.from((v(), B).subarray(Number(C) >>> 0, (Number(C) >>> 0) + 4 >>> 0)), strides: Array.from((v(), B).subarray(Number(P) >>> 0, (Number(P) >>> 0) + 2 >>> 0)), wIsConst: () => !!(v(), N)[H >>> 0], outputPadding: K ? Array.from((v(), B).subarray(Number(K) >>> 0, Number(se) >>> 0)) : [], outputShape: pe ? Array.from((v(), B).subarray(Number(pe) >>> 0, Number(xe) >>> 0)) : [], activation: Ae(Ie) });
  }, 1011494: (a, l) => {
    e4.$b("GlobalAveragePool", a, { format: l ? "NHWC" : "NCHW" });
  }, 1011585: (a, l, h, f3, w, C, P, D, H, K, se, pe, xe, Ie) => {
    e4.$b("AveragePool", a, { format: Ie ? "NHWC" : "NCHW", auto_pad: l, ceil_mode: h, count_include_pad: f3, storage_order: w, dilations: C ? Array.from((v(), B).subarray(Number(C) >>> 0, Number(P) >>> 0)) : [], kernel_shape: D ? Array.from((v(), B).subarray(Number(D) >>> 0, Number(H) >>> 0)) : [], pads: K ? Array.from((v(), B).subarray(Number(K) >>> 0, Number(se) >>> 0)) : [], strides: pe ? Array.from((v(), B).subarray(Number(pe) >>> 0, Number(xe) >>> 0)) : [] });
  }, 1012064: (a, l) => {
    e4.$b("GlobalAveragePool", a, { format: l ? "NHWC" : "NCHW" });
  }, 1012155: (a, l, h, f3, w, C, P, D, H, K, se, pe, xe, Ie) => {
    e4.$b("AveragePool", a, { format: Ie ? "NHWC" : "NCHW", auto_pad: l, ceil_mode: h, count_include_pad: f3, storage_order: w, dilations: C ? Array.from((v(), B).subarray(Number(C) >>> 0, Number(P) >>> 0)) : [], kernel_shape: D ? Array.from((v(), B).subarray(Number(D) >>> 0, Number(H) >>> 0)) : [], pads: K ? Array.from((v(), B).subarray(Number(K) >>> 0, Number(se) >>> 0)) : [], strides: pe ? Array.from((v(), B).subarray(Number(pe) >>> 0, Number(xe) >>> 0)) : [] });
  }, 1012634: (a, l) => {
    e4.$b("GlobalMaxPool", a, { format: l ? "NHWC" : "NCHW" });
  }, 1012721: (a, l, h, f3, w, C, P, D, H, K, se, pe, xe, Ie) => {
    e4.$b("MaxPool", a, { format: Ie ? "NHWC" : "NCHW", auto_pad: l, ceil_mode: h, count_include_pad: f3, storage_order: w, dilations: C ? Array.from((v(), B).subarray(Number(C) >>> 0, Number(P) >>> 0)) : [], kernel_shape: D ? Array.from((v(), B).subarray(Number(D) >>> 0, Number(H) >>> 0)) : [], pads: K ? Array.from((v(), B).subarray(Number(K) >>> 0, Number(se) >>> 0)) : [], strides: pe ? Array.from((v(), B).subarray(Number(pe) >>> 0, Number(xe) >>> 0)) : [] });
  }, 1013196: (a, l) => {
    e4.$b("GlobalMaxPool", a, { format: l ? "NHWC" : "NCHW" });
  }, 1013283: (a, l, h, f3, w, C, P, D, H, K, se, pe, xe, Ie) => {
    e4.$b("MaxPool", a, { format: Ie ? "NHWC" : "NCHW", auto_pad: l, ceil_mode: h, count_include_pad: f3, storage_order: w, dilations: C ? Array.from((v(), B).subarray(Number(C) >>> 0, Number(P) >>> 0)) : [], kernel_shape: D ? Array.from((v(), B).subarray(Number(D) >>> 0, Number(H) >>> 0)) : [], pads: K ? Array.from((v(), B).subarray(Number(K) >>> 0, Number(se) >>> 0)) : [], strides: pe ? Array.from((v(), B).subarray(Number(pe) >>> 0, Number(xe) >>> 0)) : [] });
  }, 1013758: (a, l, h, f3, w) => {
    e4.$b("Gemm", a, { alpha: l, beta: h, transA: f3, transB: w });
  }, 1013862: (a) => {
    e4.$b("MatMul", a, void 0);
  }, 1013916: (a, l, h, f3) => {
    e4.$b("ArgMax", a, { keepDims: !!l, selectLastIndex: !!h, axis: f3 });
  }, 1014024: (a, l, h, f3) => {
    e4.$b("ArgMin", a, { keepDims: !!l, selectLastIndex: !!h, axis: f3 });
  }, 1014132: (a, l) => {
    e4.$b("Softmax", a, { axis: l });
  }, 1014195: (a, l) => {
    e4.$b("Concat", a, { axis: l });
  }, 1014255: (a, l, h, f3, w) => {
    e4.$b("Split", a, { axis: l, numOutputs: h, splitSizes: f3 ? Array.from((v(), B).subarray(Number(f3) >>> 0, Number(w) >>> 0)) : [] });
  }, 1014411: (a) => {
    e4.$b("Expand", a, void 0);
  }, 1014465: (a, l) => {
    e4.$b("Gather", a, { axis: Number(l) });
  }, 1014536: (a, l) => {
    e4.$b("GatherElements", a, { axis: Number(l) });
  }, 1014615: (a, l) => {
    e4.$b("GatherND", a, { batch_dims: Number(l) });
  }, 1014694: (a, l, h, f3, w, C, P, D, H, K, se) => {
    e4.$b("Resize", a, { antialias: l, axes: h ? Array.from((v(), B).subarray(Number(h) >>> 0, Number(f3) >>> 0)) : [], coordinateTransformMode: Ae(w), cubicCoeffA: C, excludeOutside: P, extrapolationValue: D, keepAspectRatioPolicy: Ae(H), mode: Ae(K), nearestMode: Ae(se) });
  }, 1015056: (a, l, h, f3, w, C, P) => {
    e4.$b("Slice", a, { starts: l ? Array.from((v(), B).subarray(Number(l) >>> 0, Number(h) >>> 0)) : [], ends: f3 ? Array.from((v(), B).subarray(Number(f3) >>> 0, Number(w) >>> 0)) : [], axes: C ? Array.from((v(), B).subarray(Number(C) >>> 0, Number(P) >>> 0)) : [] });
  }, 1015320: (a) => {
    e4.$b("Tile", a, void 0);
  }, 1015372: (a, l, h) => {
    e4.$b("InstanceNormalization", a, { epsilon: l, format: h ? "NHWC" : "NCHW" });
  }, 1015486: (a, l, h) => {
    e4.$b("InstanceNormalization", a, { epsilon: l, format: h ? "NHWC" : "NCHW" });
  }, 1015600: (a) => {
    e4.$b("Range", a, void 0);
  }, 1015653: (a, l) => {
    e4.$b("Einsum", a, { equation: Ae(l) });
  }, 1015734: (a, l, h, f3, w) => {
    e4.$b("Pad", a, { mode: l, value: h, pads: f3 ? Array.from((v(), B).subarray(Number(f3) >>> 0, Number(w) >>> 0)) : [] });
  }, 1015877: (a, l, h, f3, w, C) => {
    e4.$b("BatchNormalization", a, { epsilon: l, momentum: h, spatial: !!w, trainingMode: !!f3, format: C ? "NHWC" : "NCHW" });
  }, 1016046: (a, l, h, f3, w, C) => {
    e4.$b("BatchNormalization", a, { epsilon: l, momentum: h, spatial: !!w, trainingMode: !!f3, format: C ? "NHWC" : "NCHW" });
  }, 1016215: (a, l, h) => {
    e4.$b("CumSum", a, { exclusive: Number(l), reverse: Number(h) });
  }, 1016312: (a, l, h) => {
    e4.$b("DequantizeLinear", a, { axis: l, blockSize: h });
  }, 1016402: (a, l, h, f3, w) => {
    e4.$b("GridSample", a, { align_corners: l, mode: Ae(h), padding_mode: Ae(f3), format: w ? "NHWC" : "NCHW" });
  }, 1016572: (a, l, h, f3, w) => {
    e4.$b("GridSample", a, { align_corners: l, mode: Ae(h), padding_mode: Ae(f3), format: w ? "NHWC" : "NCHW" });
  }, 1016742: (a, l) => {
    e4.$b("ScatterND", a, { reduction: Ae(l) });
  }, 1016827: (a, l, h, f3, w, C, P, D, H) => {
    e4.$b("Attention", a, { numHeads: l, isUnidirectional: h, maskFilterValue: f3, scale: w, doRotary: C, qkvHiddenSizes: P ? Array.from((v(), B).subarray(Number(D) >>> 0, Number(D) + P >>> 0)) : [], pastPresentShareBuffer: !!H });
  }, 1017099: (a) => {
    e4.$b("BiasAdd", a, void 0);
  }, 1017154: (a) => {
    e4.$b("BiasSplitGelu", a, void 0);
  }, 1017215: (a) => {
    e4.$b("FastGelu", a, void 0);
  }, 1017271: (a, l, h, f3, w, C, P, D, H, K, se, pe, xe, Ie, yt, Vn) => {
    e4.$b("Conv", a, { format: pe ? "NHWC" : "NCHW", auto_pad: l, dilations: h ? Array.from((v(), B).subarray(Number(h) >>> 0, Number(f3) >>> 0)) : [], group: w, kernel_shape: C ? Array.from((v(), B).subarray(Number(C) >>> 0, Number(P) >>> 0)) : [], pads: D ? Array.from((v(), B).subarray(Number(D) >>> 0, Number(H) >>> 0)) : [], strides: K ? Array.from((v(), B).subarray(Number(K) >>> 0, Number(se) >>> 0)) : [], w_is_const: () => !!(v(), N)[Number(xe) >>> 0], activation: Ae(Ie), activation_params: yt ? Array.from((v(), Q).subarray(Number(yt) >>> 0, Number(Vn) >>> 0)) : [] });
  }, 1017855: (a) => {
    e4.$b("Gelu", a, void 0);
  }, 1017907: (a, l, h, f3, w, C, P, D, H) => {
    e4.$b("GroupQueryAttention", a, { numHeads: l, kvNumHeads: h, scale: f3, softcap: w, doRotary: C, rotaryInterleaved: P, smoothSoftmax: D, localWindowSize: H });
  }, 1018124: (a, l, h, f3) => {
    e4.$b("LayerNormalization", a, { axis: l, epsilon: h, simplified: !!f3 });
  }, 1018235: (a, l, h, f3) => {
    e4.$b("LayerNormalization", a, { axis: l, epsilon: h, simplified: !!f3 });
  }, 1018346: (a, l, h, f3, w, C) => {
    e4.$b("MatMulNBits", a, { k: l, n: h, accuracyLevel: f3, bits: w, blockSize: C });
  }, 1018473: (a, l, h, f3, w, C) => {
    e4.$b("MultiHeadAttention", a, { numHeads: l, isUnidirectional: h, maskFilterValue: f3, scale: w, doRotary: C });
  }, 1018632: (a, l) => {
    e4.$b("QuickGelu", a, { alpha: l });
  }, 1018696: (a, l, h, f3, w) => {
    e4.$b("RotaryEmbedding", a, { interleaved: !!l, numHeads: h, rotaryEmbeddingDim: f3, scale: w });
  }, 1018835: (a, l, h) => {
    e4.$b("SkipLayerNormalization", a, { epsilon: l, simplified: !!h });
  }, 1018937: (a, l, h) => {
    e4.$b("SkipLayerNormalization", a, { epsilon: l, simplified: !!h });
  }, 1019039: (a, l, h, f3) => {
    e4.$b("GatherBlockQuantized", a, { gatherAxis: l, quantizeAxis: h, blockSize: f3 });
  }, 1019160: (a) => {
    e4.Fd(a);
  }, 1019194: (a, l) => e4.Hd(Number(a), Number(l), e4.Yc.Kd, e4.Yc.errors) };
  function Cm(a, l, h) {
    return yi(async () => {
      await e4.Dd(Number(a), Number(l), Number(h));
    });
  }
  function Am() {
    return typeof wasmOffsetConverter < "u";
  }
  function Em(a, l, h, f3) {
    var w = de();
    try {
      return ea(a, l, h, f3);
    } catch (C) {
      if (ue(w), C !== C + 0) throw C;
      ce(1, 0);
    }
  }
  function km(a, l, h) {
    var f3 = de();
    try {
      return Qi(a, l, h);
    } catch (w) {
      if (ue(f3), w !== w + 0) throw w;
      ce(1, 0);
    }
  }
  function Pm(a) {
    var l = de();
    try {
      Ki(a);
    } catch (h) {
      if (ue(l), h !== h + 0) throw h;
      ce(1, 0);
    }
  }
  function Om(a, l) {
    var h = de();
    try {
      return Un(a, l);
    } catch (f3) {
      if (ue(h), f3 !== f3 + 0) throw f3;
      ce(1, 0);
    }
  }
  function zm(a, l, h) {
    var f3 = de();
    try {
      qi(a, l, h);
    } catch (w) {
      if (ue(f3), w !== w + 0) throw w;
      ce(1, 0);
    }
  }
  function Bm(a, l) {
    var h = de();
    try {
      ta(a, l);
    } catch (f3) {
      if (ue(h), f3 !== f3 + 0) throw f3;
      ce(1, 0);
    }
  }
  function Dm(a, l, h, f3, w, C, P) {
    var D = de();
    try {
      return Xi(a, l, h, f3, w, C, P);
    } catch (H) {
      if (ue(D), H !== H + 0) throw H;
      ce(1, 0);
    }
  }
  function Mm(a, l, h, f3, w, C) {
    var P = de();
    try {
      ji(a, l, h, f3, w, C);
    } catch (D) {
      if (ue(P), D !== D + 0) throw D;
      ce(1, 0);
    }
  }
  function Rm(a, l, h, f3) {
    var w = de();
    try {
      Ji(a, l, h, f3);
    } catch (C) {
      if (ue(w), C !== C + 0) throw C;
      ce(1, 0);
    }
  }
  function Um(a, l, h, f3, w) {
    var C = de();
    try {
      Zi(a, l, h, f3, w);
    } catch (P) {
      if (ue(C), P !== P + 0) throw P;
      ce(1, 0);
    }
  }
  function Nm(a, l, h, f3, w, C, P) {
    var D = de();
    try {
      na(a, l, h, f3, w, C, P);
    } catch (H) {
      if (ue(D), H !== H + 0) throw H;
      ce(1, 0);
    }
  }
  function Vm(a, l, h, f3, w, C, P) {
    var D = de();
    try {
      oa(a, l, h, f3, w, C, P);
    } catch (H) {
      if (ue(D), H !== H + 0) throw H;
      ce(1, 0);
    }
  }
  function Lm(a, l, h, f3, w, C, P, D) {
    var H = de();
    try {
      ua(a, l, h, f3, w, C, P, D);
    } catch (K) {
      if (ue(H), K !== K + 0) throw K;
      ce(1, 0);
    }
  }
  function Wm(a, l, h, f3, w) {
    var C = de();
    try {
      return ra(a, l, h, f3, w);
    } catch (P) {
      if (ue(C), P !== P + 0) throw P;
      ce(1, 0);
    }
  }
  function Gm(a, l, h) {
    var f3 = de();
    try {
      return da(a, l, h);
    } catch (w) {
      if (ue(f3), w !== w + 0) throw w;
      ce(1, 0);
    }
  }
  function Hm(a, l, h, f3, w, C, P, D) {
    var H = de();
    try {
      la(a, l, h, f3, w, C, P, D);
    } catch (K) {
      if (ue(H), K !== K + 0) throw K;
      ce(1, 0);
    }
  }
  function Fm(a, l, h, f3, w, C, P, D, H, K, se, pe) {
    var xe = de();
    try {
      ia(a, l, h, f3, w, C, P, D, H, K, se, pe);
    } catch (Ie) {
      if (ue(xe), Ie !== Ie + 0) throw Ie;
      ce(1, 0);
    }
  }
  function qm(a, l, h, f3, w, C) {
    var P = de();
    try {
      return aa(a, l, h, f3, w, C);
    } catch (D) {
      if (ue(P), D !== D + 0) throw D;
      ce(1, 0);
    }
  }
  function Km(a, l, h) {
    var f3 = de();
    try {
      return ca(a, l, h);
    } catch (w) {
      if (ue(f3), w !== w + 0) throw w;
      return ce(1, 0), 0n;
    }
  }
  function jm(a, l, h, f3, w, C, P, D, H) {
    var K = de();
    try {
      Yi(a, l, h, f3, w, C, P, D, H);
    } catch (se) {
      if (ue(K), se !== se + 0) throw se;
      ce(1, 0);
    }
  }
  function Zm(a) {
    var l = de();
    try {
      return pa(a);
    } catch (h) {
      if (ue(l), h !== h + 0) throw h;
      ce(1, 0);
    }
  }
  function Qm(a, l) {
    var h = de();
    try {
      return Ca(a, l);
    } catch (f3) {
      if (ue(h), f3 !== f3 + 0) throw f3;
      return ce(1, 0), 0n;
    }
  }
  function Ym(a) {
    var l = de();
    try {
      return ma(a);
    } catch (h) {
      if (ue(l), h !== h + 0) throw h;
      return ce(1, 0), 0n;
    }
  }
  function Xm(a, l, h, f3) {
    var w = de();
    try {
      return _a(a, l, h, f3);
    } catch (C) {
      if (ue(w), C !== C + 0) throw C;
      ce(1, 0);
    }
  }
  function Jm(a, l, h, f3, w) {
    var C = de();
    try {
      return wa(a, l, h, f3, w);
    } catch (P) {
      if (ue(C), P !== P + 0) throw P;
      ce(1, 0);
    }
  }
  function ef(a, l, h, f3, w, C) {
    var P = de();
    try {
      return va(a, l, h, f3, w, C);
    } catch (D) {
      if (ue(P), D !== D + 0) throw D;
      ce(1, 0);
    }
  }
  function tf(a, l, h, f3, w, C) {
    var P = de();
    try {
      return $a(a, l, h, f3, w, C);
    } catch (D) {
      if (ue(P), D !== D + 0) throw D;
      ce(1, 0);
    }
  }
  function rf(a, l, h, f3, w, C, P, D) {
    var H = de();
    try {
      return sa(a, l, h, f3, w, C, P, D);
    } catch (K) {
      if (ue(H), K !== K + 0) throw K;
      ce(1, 0);
    }
  }
  function nf(a, l, h, f3, w) {
    var C = de();
    try {
      return xa(a, l, h, f3, w);
    } catch (P) {
      if (ue(C), P !== P + 0) throw P;
      return ce(1, 0), 0n;
    }
  }
  function of(a, l, h, f3) {
    var w = de();
    try {
      return Sa(a, l, h, f3);
    } catch (C) {
      if (ue(w), C !== C + 0) throw C;
      ce(1, 0);
    }
  }
  function af(a, l, h, f3) {
    var w = de();
    try {
      return Ta(a, l, h, f3);
    } catch (C) {
      if (ue(w), C !== C + 0) throw C;
      ce(1, 0);
    }
  }
  function sf(a, l, h, f3, w, C, P, D, H, K, se, pe) {
    var xe = de();
    try {
      return Ia(a, l, h, f3, w, C, P, D, H, K, se, pe);
    } catch (Ie) {
      if (ue(xe), Ie !== Ie + 0) throw Ie;
      ce(1, 0);
    }
  }
  function uf(a, l, h, f3, w, C, P, D, H, K, se) {
    var pe = de();
    try {
      ba(a, l, h, f3, w, C, P, D, H, K, se);
    } catch (xe) {
      if (ue(pe), xe !== xe + 0) throw xe;
      ce(1, 0);
    }
  }
  function df(a, l, h, f3, w, C, P, D, H, K, se, pe, xe, Ie, yt, Vn) {
    var mf = de();
    try {
      ya(a, l, h, f3, w, C, P, D, H, K, se, pe, xe, Ie, yt, Vn);
    } catch (Ln) {
      if (ue(mf), Ln !== Ln + 0) throw Ln;
      ce(1, 0);
    }
  }
  function lf(a, l, h) {
    var f3 = de();
    try {
      return fa(a, l, h);
    } catch (w) {
      if (ue(f3), w !== w + 0) throw w;
      ce(1, 0);
    }
  }
  function cf(a, l, h) {
    var f3 = de();
    try {
      return ha(a, l, h);
    } catch (w) {
      if (ue(f3), w !== w + 0) throw w;
      ce(1, 0);
    }
  }
  function pf(a, l, h, f3) {
    var w = de();
    try {
      ga(a, l, h, f3);
    } catch (C) {
      if (ue(w), C !== C + 0) throw C;
      ce(1, 0);
    }
  }
  function $r() {
    if (0 < he) Te = $r;
    else if (o) _?.(e4), ve();
    else {
      for (var a = Pe; 0 < a.length; ) a.shift()(e4);
      0 < he ? Te = $r : (e4.calledRun = true, A || (ve(), _?.(e4)));
    }
  }
  return o || (ct = await be(), $r()), e4.PTR_SIZE = 4, le ? e4 : new Promise((a, l) => {
    _ = a, T = l;
  });
}
var vf;
var $f;
var ms = V(() => {
  "use strict";
  vf = cs, $f = globalThis.self?.name?.startsWith("em-pthread");
  $f && cs();
});
var gs;
var Xn;
var xf;
var We;
var bs;
var Yn;
var Sf;
var Tf;
var ys;
var If;
var fs;
var _s;
var hs;
var ws;
var Ar = V(() => {
  "use strict";
  Cr();
  gs = typeof location > "u" ? void 0 : location.origin, Xn = import.meta.url > "file:" && import.meta.url < "file;", xf = () => {
    if (true) {
      if (Xn) {
        let t = URL;
        return new URL(new t("ort.bundle.min.mjs", import.meta.url).href, gs).href;
      }
      return import.meta.url;
    }
  }, We = xf(), bs = () => {
    if (We && !We.startsWith("blob:")) return We.substring(0, We.lastIndexOf("/") + 1);
  }, Yn = (t, e4) => {
    try {
      let r = e4 ?? We;
      return (r ? new URL(t, r) : new URL(t)).origin === gs;
    } catch {
      return false;
    }
  }, Sf = (t, e4) => {
    let r = e4 ?? We;
    try {
      return (r ? new URL(t, r) : new URL(t)).href;
    } catch {
      return;
    }
  }, Tf = (t, e4) => `${e4 ?? "./"}${t}`, ys = async (t) => {
    let r = await (await fetch(t, { credentials: "same-origin" })).blob();
    return URL.createObjectURL(r);
  }, If = async (t) => (await import(
    /*webpackIgnore:true*/
    /*@vite-ignore*/
    t
  )).default, fs = (ls(), Xt(ds)).default, _s = async () => {
    if (!We) throw new Error("Failed to load proxy worker: cannot determine the script source URL.");
    if (Yn(We)) return [void 0, fs()];
    let t = await ys(We);
    return [t, fs(t)];
  }, hs = (ms(), Xt(ps)).default, ws = async (t, e4, r, n) => {
    let o = hs && !(t || e4);
    if (o) if (We) o = Yn(We) || n && !r;
    else if (n && !r) o = true;
    else throw new Error("cannot determine the script source URL.");
    if (o) return [void 0, hs];
    {
      let i = "ort-wasm-simd-threaded.jsep.mjs", s = t ?? Sf(i, e4), u = r && s && !Yn(s, e4), d = u ? await ys(s) : s ?? Tf(i, e4);
      return [u ? d : void 0, await If(d)];
    }
  };
});
var Jn;
var eo;
var Rr;
var vs;
var Cf;
var Af;
var Ef;
var Er;
var ye;
var vt = V(() => {
  "use strict";
  Ar();
  eo = false, Rr = false, vs = false, Cf = () => {
    if (typeof SharedArrayBuffer > "u") return false;
    try {
      return typeof MessageChannel < "u" && new MessageChannel().port1.postMessage(new SharedArrayBuffer(1)), WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 4, 1, 3, 1, 1, 10, 11, 1, 9, 0, 65, 0, 254, 16, 2, 0, 26, 11]));
    } catch {
      return false;
    }
  }, Af = () => {
    try {
      return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 30, 1, 28, 0, 65, 0, 253, 15, 253, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 253, 186, 1, 26, 11]));
    } catch {
      return false;
    }
  }, Ef = () => {
    try {
      return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 19, 1, 17, 0, 65, 1, 253, 15, 65, 2, 253, 15, 65, 3, 253, 15, 253, 147, 2, 11]));
    } catch {
      return false;
    }
  }, Er = async (t) => {
    if (eo) return Promise.resolve();
    if (Rr) throw new Error("multiple calls to 'initializeWebAssembly()' detected.");
    if (vs) throw new Error("previous call to 'initializeWebAssembly()' failed.");
    Rr = true;
    let e4 = t.initTimeout, r = t.numThreads;
    if (t.simd !== false) {
      if (t.simd === "relaxed") {
        if (!Ef()) throw new Error("Relaxed WebAssembly SIMD is not supported in the current environment.");
      } else if (!Af()) throw new Error("WebAssembly SIMD is not supported in the current environment.");
    }
    let n = Cf();
    r > 1 && !n && (typeof self < "u" && !self.crossOriginIsolated && console.warn("env.wasm.numThreads is set to " + r + ", but this will not work unless you enable crossOriginIsolated mode. See https://web.dev/cross-origin-isolation-guide/ for more info."), console.warn("WebAssembly multi-threading is not supported in the current environment. Falling back to single-threading."), t.numThreads = r = 1);
    let o = t.wasmPaths, i = typeof o == "string" ? o : void 0, s = o?.mjs, u = s?.href ?? s, d = o?.wasm, c2 = d?.href ?? d, p4 = t.wasmBinary, [m, g] = await ws(u, i, r > 1, !!p4 || !!c2), y = false, b = [];
    if (e4 > 0 && b.push(new Promise((_) => {
      setTimeout(() => {
        y = true, _();
      }, e4);
    })), b.push(new Promise((_, T) => {
      let x = { numThreads: r };
      if (p4) x.wasmBinary = p4, x.locateFile = ($) => $;
      else if (c2 || i) x.locateFile = ($) => c2 ?? i + $;
      else if (u && u.indexOf("blob:") !== 0) x.locateFile = ($) => new URL($, u).href;
      else if (m) {
        let $ = bs();
        $ && (x.locateFile = (S) => $ + S);
      }
      g(x).then(($) => {
        Rr = false, eo = true, Jn = $, _(), m && URL.revokeObjectURL(m);
      }, ($) => {
        Rr = false, vs = true, T($);
      });
    })), await Promise.race(b), y) throw new Error(`WebAssembly backend initializing failed due to timeout: ${e4}ms`);
  }, ye = () => {
    if (eo && Jn) return Jn;
    throw new Error("WebAssembly is not initialized yet.");
  };
});
var Ge;
var tr;
var me;
var Ur = V(() => {
  "use strict";
  vt();
  Ge = (t, e4) => {
    let r = ye(), n = r.lengthBytesUTF8(t) + 1, o = r._malloc(n);
    return r.stringToUTF8(t, o, n), e4.push(o), o;
  }, tr = (t, e4, r, n) => {
    if (typeof t == "object" && t !== null) {
      if (r.has(t)) throw new Error("Circular reference in options");
      r.add(t);
    }
    Object.entries(t).forEach(([o, i]) => {
      let s = e4 ? e4 + o : o;
      if (typeof i == "object") tr(i, s + ".", r, n);
      else if (typeof i == "string" || typeof i == "number") n(s, i.toString());
      else if (typeof i == "boolean") n(s, i ? "1" : "0");
      else throw new Error(`Can't handle extra config type: ${typeof i}`);
    });
  }, me = (t) => {
    let e4 = ye(), r = e4.stackSave();
    try {
      let n = e4.PTR_SIZE, o = e4.stackAlloc(2 * n);
      e4._OrtGetLastError(o, o + n);
      let i = Number(e4.getValue(o, n === 4 ? "i32" : "i64")), s = e4.getValue(o + n, "*"), u = s ? e4.UTF8ToString(s) : "";
      throw new Error(`${t} ERROR_CODE: ${i}, ERROR_MESSAGE: ${u}`);
    } finally {
      e4.stackRestore(r);
    }
  };
});
var $s;
var xs = V(() => {
  "use strict";
  vt();
  Ur();
  $s = (t) => {
    let e4 = ye(), r = 0, n = [], o = t || {};
    try {
      if (t?.logSeverityLevel === void 0) o.logSeverityLevel = 2;
      else if (typeof t.logSeverityLevel != "number" || !Number.isInteger(t.logSeverityLevel) || t.logSeverityLevel < 0 || t.logSeverityLevel > 4) throw new Error(`log severity level is not valid: ${t.logSeverityLevel}`);
      if (t?.logVerbosityLevel === void 0) o.logVerbosityLevel = 0;
      else if (typeof t.logVerbosityLevel != "number" || !Number.isInteger(t.logVerbosityLevel)) throw new Error(`log verbosity level is not valid: ${t.logVerbosityLevel}`);
      t?.terminate === void 0 && (o.terminate = false);
      let i = 0;
      return t?.tag !== void 0 && (i = Ge(t.tag, n)), r = e4._OrtCreateRunOptions(o.logSeverityLevel, o.logVerbosityLevel, !!o.terminate, i), r === 0 && me("Can't create run options."), t?.extra !== void 0 && tr(t.extra, "", /* @__PURE__ */ new WeakSet(), (s, u) => {
        let d = Ge(s, n), c2 = Ge(u, n);
        e4._OrtAddRunConfigEntry(r, d, c2) !== 0 && me(`Can't set a run config entry: ${s} - ${u}.`);
      }), [r, n];
    } catch (i) {
      throw r !== 0 && e4._OrtReleaseRunOptions(r), n.forEach((s) => e4._free(s)), i;
    }
  };
});
var kf;
var Pf;
var Of;
var Lt;
var zf;
var Ss;
var Ts = V(() => {
  "use strict";
  vt();
  Ur();
  kf = (t) => {
    switch (t) {
      case "disabled":
        return 0;
      case "basic":
        return 1;
      case "extended":
        return 2;
      case "layout":
        return 3;
      case "all":
        return 99;
      default:
        throw new Error(`unsupported graph optimization level: ${t}`);
    }
  }, Pf = (t) => {
    switch (t) {
      case "sequential":
        return 0;
      case "parallel":
        return 1;
      default:
        throw new Error(`unsupported execution mode: ${t}`);
    }
  }, Of = (t) => {
    t.extra || (t.extra = {}), t.extra.session || (t.extra.session = {});
    let e4 = t.extra.session;
    e4.use_ort_model_bytes_directly || (e4.use_ort_model_bytes_directly = "1"), t.executionProviders && t.executionProviders.some((r) => (typeof r == "string" ? r : r.name) === "webgpu") && (t.enableMemPattern = false);
  }, Lt = (t, e4, r, n) => {
    let o = Ge(e4, n), i = Ge(r, n);
    ye()._OrtAddSessionConfigEntry(t, o, i) !== 0 && me(`Can't set a session config entry: ${e4} - ${r}.`);
  }, zf = async (t, e4, r) => {
    let n = e4.executionProviders;
    for (let o of n) {
      let i = typeof o == "string" ? o : o.name, s = [];
      switch (i) {
        case "webnn":
          if (i = "WEBNN", Lt(t, "session.disable_quant_qdq", "1", r), Lt(t, "session.disable_qdq_constant_folding", "1", r), typeof o != "string") {
            let g = o?.deviceType;
            g && Lt(t, "deviceType", g, r);
          }
          break;
        case "webgpu":
          if (i = "JS", typeof o != "string") {
            let m = o;
            if (m?.preferredLayout) {
              if (m.preferredLayout !== "NCHW" && m.preferredLayout !== "NHWC") throw new Error(`preferredLayout must be either 'NCHW' or 'NHWC': ${m.preferredLayout}`);
              Lt(t, "preferredLayout", m.preferredLayout, r);
            }
          }
          break;
        case "wasm":
        case "cpu":
          continue;
        default:
          throw new Error(`not supported execution provider: ${i}`);
      }
      let u = Ge(i, r), d = s.length, c2 = 0, p4 = 0;
      if (d > 0) {
        c2 = ye()._malloc(d * ye().PTR_SIZE), r.push(c2), p4 = ye()._malloc(d * ye().PTR_SIZE), r.push(p4);
        for (let m = 0; m < d; m++) ye().setValue(c2 + m * ye().PTR_SIZE, s[m][0], "*"), ye().setValue(p4 + m * ye().PTR_SIZE, s[m][1], "*");
      }
      await ye()._OrtAppendExecutionProvider(t, u, c2, p4, d) !== 0 && me(`Can't append execution provider: ${i}.`);
    }
  }, Ss = async (t) => {
    let e4 = ye(), r = 0, n = [], o = t || {};
    Of(o);
    try {
      let i = kf(o.graphOptimizationLevel ?? "all"), s = Pf(o.executionMode ?? "sequential"), u = typeof o.logId == "string" ? Ge(o.logId, n) : 0, d = o.logSeverityLevel ?? 2;
      if (!Number.isInteger(d) || d < 0 || d > 4) throw new Error(`log severity level is not valid: ${d}`);
      let c2 = o.logVerbosityLevel ?? 0;
      if (!Number.isInteger(c2) || c2 < 0 || c2 > 4) throw new Error(`log verbosity level is not valid: ${c2}`);
      let p4 = typeof o.optimizedModelFilePath == "string" ? Ge(o.optimizedModelFilePath, n) : 0;
      if (r = e4._OrtCreateSessionOptions(i, !!o.enableCpuMemArena, !!o.enableMemPattern, s, !!o.enableProfiling, 0, u, d, c2, p4), r === 0 && me("Can't create session options."), o.executionProviders && await zf(r, o, n), o.enableGraphCapture !== void 0) {
        if (typeof o.enableGraphCapture != "boolean") throw new Error(`enableGraphCapture must be a boolean value: ${o.enableGraphCapture}`);
        Lt(r, "enableGraphCapture", o.enableGraphCapture.toString(), n);
      }
      if (o.freeDimensionOverrides) for (let [m, g] of Object.entries(o.freeDimensionOverrides)) {
        if (typeof m != "string") throw new Error(`free dimension override name must be a string: ${m}`);
        if (typeof g != "number" || !Number.isInteger(g) || g < 0) throw new Error(`free dimension override value must be a non-negative integer: ${g}`);
        let y = Ge(m, n);
        e4._OrtAddFreeDimensionOverride(r, y, g) !== 0 && me(`Can't set a free dimension override: ${m} - ${g}.`);
      }
      return o.extra !== void 0 && tr(o.extra, "", /* @__PURE__ */ new WeakSet(), (m, g) => {
        Lt(r, m, g, n);
      }), [r, n];
    } catch (i) {
      throw r !== 0 && e4._OrtReleaseSessionOptions(r) !== 0 && me("Can't release session options."), n.forEach((s) => e4._free(s)), i;
    }
  };
});
var $t;
var rt;
var xt;
var Wt;
var rr;
var Nr;
var Vr;
var to;
var J = V(() => {
  "use strict";
  $t = (t) => {
    switch (t) {
      case "int8":
        return 3;
      case "uint8":
        return 2;
      case "bool":
        return 9;
      case "int16":
        return 5;
      case "uint16":
        return 4;
      case "int32":
        return 6;
      case "uint32":
        return 12;
      case "float16":
        return 10;
      case "float32":
        return 1;
      case "float64":
        return 11;
      case "string":
        return 8;
      case "int64":
        return 7;
      case "uint64":
        return 13;
      case "int4":
        return 22;
      case "uint4":
        return 21;
      default:
        throw new Error(`unsupported data type: ${t}`);
    }
  }, rt = (t) => {
    switch (t) {
      case 3:
        return "int8";
      case 2:
        return "uint8";
      case 9:
        return "bool";
      case 5:
        return "int16";
      case 4:
        return "uint16";
      case 6:
        return "int32";
      case 12:
        return "uint32";
      case 10:
        return "float16";
      case 1:
        return "float32";
      case 11:
        return "float64";
      case 8:
        return "string";
      case 7:
        return "int64";
      case 13:
        return "uint64";
      case 22:
        return "int4";
      case 21:
        return "uint4";
      default:
        throw new Error(`unsupported data type: ${t}`);
    }
  }, xt = (t, e4) => {
    let r = [-1, 4, 1, 1, 2, 2, 4, 8, -1, 1, 2, 8, 4, 8, -1, -1, -1, -1, -1, -1, -1, 0.5, 0.5][t], n = typeof e4 == "number" ? e4 : e4.reduce((o, i) => o * i, 1);
    return r > 0 ? Math.ceil(n * r) : void 0;
  }, Wt = (t) => {
    switch (t) {
      case "float16":
        return typeof Float16Array < "u" ? Float16Array : Uint16Array;
      case "float32":
        return Float32Array;
      case "uint8":
        return Uint8Array;
      case "int8":
        return Int8Array;
      case "uint16":
        return Uint16Array;
      case "int16":
        return Int16Array;
      case "int32":
        return Int32Array;
      case "bool":
        return Uint8Array;
      case "float64":
        return Float64Array;
      case "uint32":
        return Uint32Array;
      case "int64":
        return BigInt64Array;
      case "uint64":
        return BigUint64Array;
      default:
        throw new Error(`unsupported type: ${t}`);
    }
  }, rr = (t) => {
    switch (t) {
      case "verbose":
        return 0;
      case "info":
        return 1;
      case "warning":
        return 2;
      case "error":
        return 3;
      case "fatal":
        return 4;
      default:
        throw new Error(`unsupported logging level: ${t}`);
    }
  }, Nr = (t) => t === "float32" || t === "float16" || t === "int32" || t === "int64" || t === "uint32" || t === "uint8" || t === "bool" || t === "uint4" || t === "int4", Vr = (t) => t === "float32" || t === "float16" || t === "int32" || t === "int64" || t === "uint32" || t === "uint64" || t === "int8" || t === "uint8" || t === "bool" || t === "uint4" || t === "int4", to = (t) => {
    switch (t) {
      case "none":
        return 0;
      case "cpu":
        return 1;
      case "cpu-pinned":
        return 2;
      case "texture":
        return 3;
      case "gpu-buffer":
        return 4;
      case "ml-tensor":
        return 5;
      default:
        throw new Error(`unsupported data location: ${t}`);
    }
  };
});
var nr;
var ro = V(() => {
  "use strict";
  Cr();
  nr = async (t) => {
    if (typeof t == "string") if (false) try {
      let { readFile: e4 } = Gn("node:fs/promises");
      return new Uint8Array(await e4(t));
    } catch (e4) {
      if (e4.code === "ERR_FS_FILE_TOO_LARGE") {
        let { createReadStream: r } = Gn("node:fs"), n = r(t), o = [];
        for await (let i of n) o.push(i);
        return new Uint8Array(Buffer.concat(o));
      }
      throw e4;
    }
    else {
      let e4 = await fetch(t);
      if (!e4.ok) throw new Error(`failed to load external data file: ${t}`);
      let r = e4.headers.get("Content-Length"), n = r ? parseInt(r, 10) : 0;
      if (n < 1073741824) return new Uint8Array(await e4.arrayBuffer());
      {
        if (!e4.body) throw new Error(`failed to load external data file: ${t}, no response body.`);
        let o = e4.body.getReader(), i;
        try {
          i = new ArrayBuffer(n);
        } catch (u) {
          if (u instanceof RangeError) {
            let d = Math.ceil(n / 65536);
            i = new WebAssembly.Memory({ initial: d, maximum: d }).buffer;
          } else throw u;
        }
        let s = 0;
        for (; ; ) {
          let { done: u, value: d } = await o.read();
          if (u) break;
          let c2 = d.byteLength;
          new Uint8Array(i, s, c2).set(d), s += c2;
        }
        return new Uint8Array(i, 0, n);
      }
    }
    else return t instanceof Blob ? new Uint8Array(await t.arrayBuffer()) : t instanceof Uint8Array ? t : new Uint8Array(t);
  };
});
var Bf;
var Df;
var Is;
var Cs;
var Lr;
var Mf;
var ie;
var nt = V(() => {
  "use strict";
  J();
  Bf = ["V", "I", "W", "E", "F"], Df = (t, e4) => {
    console.log(`[${Bf[t]},${(/* @__PURE__ */ new Date()).toISOString()}]${e4}`);
  }, Lr = (t, e4) => {
    Is = t, Cs = e4;
  }, Mf = (t, e4) => {
    let r = rr(t), n = rr(Is);
    r >= n && Df(r, typeof e4 == "function" ? e4() : e4);
  }, ie = (...t) => {
    Cs && Mf(...t);
  };
});
var no;
var ot;
var k4;
var zt;
var Wr;
var As;
var Es;
var re = V(() => {
  "use strict";
  no = class {
    static calcMatMulShape(e4, r) {
      return e4[1] !== r[0] ? void 0 : [e4[0], r[1]];
    }
  }, ot = class {
    static calcShape(e4, r, n = false) {
      let o = e4.length, i = r.length;
      if (o === 0) return r;
      if (i === 0) return e4;
      let s = Math.max(e4.length, r.length), u = new Array(s);
      if (n) {
        if (o < 2 || i < 2) return;
        let d = no.calcMatMulShape([e4[o - 2], e4[o - 1]], [r[i - 2], r[i - 1]]);
        if (d === void 0) return;
        [u[s - 2], u[s - 1]] = d;
      }
      for (let d = n ? 3 : 1; d <= s; d++) {
        let c2 = o - d < 0 ? 1 : e4[o - d], p4 = i - d < 0 ? 1 : r[i - d];
        if (c2 !== p4 && c2 > 1 && p4 > 1) return;
        let m = Math.max(c2, p4);
        if (c2 && p4) u[s - d] = Math.max(c2, p4);
        else {
          if (m > 1) return;
          u[s - d] = 0;
        }
      }
      return u;
    }
    static isValidBroadcast(e4, r) {
      let n = e4.length, o = r.length;
      if (n > o) return false;
      for (let i = 1; i <= n; i++) if (e4[n - i] !== 1 && e4[n - i] !== r[o - i]) return false;
      return true;
    }
  }, k4 = class t {
    static size(e4) {
      return t.getSizeFromDimensionRange(e4, 0, e4.length);
    }
    static convertShape(e4, r = 4) {
      let n = e4.length;
      if (n === 0) return [];
      let o = new Array(n), i = n - 1;
      for (; i >= 0; ) {
        if (e4[i] % r === 0) {
          o[i] = e4[i] / r;
          break;
        }
        if (r % e4[i] !== 0) throw new Error("cannot convert shape");
        o[i] = 1, r /= e4[i], i--;
      }
      for (i--; i >= 0; i--) o[i] = e4[i];
      return o;
    }
    static sizeFromDimension(e4, r) {
      if (r < 0 || r > e4.length) throw new Error(`invalid dimension of ${r} for sizeFromDimension as Tensor has ${e4.length} dimensions.`);
      return t.getSizeFromDimensionRange(e4, r, e4.length);
    }
    static sizeToDimension(e4, r) {
      if (r < 0 || r > e4.length) throw new Error(`invalid dimension of ${r} for sizeToDimension as Tensor has ${e4.length} dimensions.`);
      return t.getSizeFromDimensionRange(e4, 0, r);
    }
    static getSizeFromDimensionRange(e4, r, n) {
      let o = 1;
      for (let i = r; i < n; i++) {
        if (e4[i] < 0) throw new Error("cannot get valid size from specified dimension range. Most likely the range contains negative values in them.");
        o *= Number(e4[i]);
      }
      return o;
    }
    static computeStrides(e4) {
      let r = e4.length;
      if (r === 0) return [];
      if (r === 1) return [1];
      let n = new Array(r);
      n[r - 1] = 1, n[r - 2] = e4[r - 1];
      for (let o = r - 3; o >= 0; --o) n[o] = n[o + 1] * e4[o + 1];
      return n;
    }
    static normalizeAxis(e4, r) {
      if (e4 < -r && e4 >= r) throw new Error("unsupported axis for this operation.");
      return e4 < 0 ? e4 + r : e4;
    }
    static normalizeAxes(e4, r) {
      return e4.map((n) => this.normalizeAxis(n, r ?? e4.length));
    }
    static sortBasedOnPerm(e4, r) {
      return r ? r.map((n) => e4[n]) : e4.slice().reverse();
    }
    static padShape(e4, r) {
      let n = e4.length;
      return e4.map((o, i) => o + r[i] + r[i + n]);
    }
    static areEqual(e4, r) {
      return e4.length !== r.length ? false : e4.every((n, o) => n === r[o]);
    }
  }, zt = class t {
    static adjustPoolAttributes(e4, r, n, o, i, s) {
      if (!e4 && n.length !== r.length - 2) throw new Error("length of specified kernel shapes should be 2 less than length of input dimensions");
      if (e4) for (let u = 0; u < r.length - 2; u++) u >= n.length ? n.push(r[u + 2]) : n[u] = r[u + 2];
      for (let u = 0; u < n.length; u++) if (u < o.length) {
        if (o[u] < 0) throw new Error("strides should be greater than or equal to 1");
      } else o.push(1);
      for (let u = 0; u < n.length; u++) if (u < i.length) {
        if (i[u] < 0) throw new Error("dilations should be greater than or equal to 1");
      } else i.push(1);
      for (let u = 0; u < n.length * 2; u++) if (u < s.length) {
        if (s[u] < 0) throw new Error("pad should be greater than or equal to 1");
      } else s.push(0);
      for (let u = 0; u < n.length; u++) {
        if (n[u] <= 0) throw new Error("kernel shapes need to be greater than 0");
        if (s[u] >= n[u] || s[u + n.length] >= n[u]) throw new Error("pads should be smaller than kernel");
      }
    }
    static adjustPadsBasedOnAutoPad(e4, r, n, o, i, s, u) {
      if (u) {
        if (i.length !== 2 * (e4.length - 2)) throw new Error("length of pads should be twice the length of data dimensions");
        if (r.length !== e4.length - 2) throw new Error("length of strides should be the length of data dimensions");
        if (o.length !== e4.length - 2) throw new Error("length of kernel shapes should be the length of data dimensions");
        for (let d = 0; d < e4.length - 2; d++) t.adjustPadAndReturnShape(e4[d + (s ? 1 : 2)], r[d], n[d], o[d], i, d, d + e4.length - 2, u);
      }
    }
    static computePoolOutputShape(e4, r, n, o, i, s, u) {
      if (r.length <= 0) throw new Error("input shape must be of size greater than 0");
      let d = [r[0], r[1]];
      return t.computeShapeHelper(e4, r, d, n, o, i, s, u), d;
    }
    static computeConvOutputShape(e4, r, n, o, i, s, u) {
      if (e4.length <= 0 || r.length <= 0) throw new Error("invalid input tensor dims or invalid filter tensor dims");
      let d = [e4[0], r[0]];
      return t.computeShapeHelper(false, e4, d, n, o, i, s, u), d;
    }
    static computeShapeHelper(e4, r, n, o, i, s, u, d) {
      if (e4) for (let c2 = 0; c2 < r.length - 2; c2++) n.push(1);
      else for (let c2 = 0; c2 < r.length - 2; c2++) n.push(t.adjustPadAndReturnShape(r[c2 + 2], o[c2], i[c2], s[c2], u, c2, c2 + r.length - 2, d));
    }
    static adjustPadAndReturnShape(e4, r, n, o, i, s, u, d) {
      let c2 = n * (o - 1) + 1;
      if (d && d !== "NOTSET") switch (d) {
        case "VALID":
          return i[s] = 0, i[u] = 0, Math.floor((e4 - c2) / r + 1);
        case "SAME_LOWER":
        case "SAME_UPPER":
          if (n !== 1) throw new Error("Dilation not supported for SAME_UPPER or SAME_LOWER");
          {
            let m = ((e4 + r - 1) / r - 1) * r + o - e4;
            return i[s] = Math.floor(d === "SAME_LOWER" ? (m + 1) / 2 : m / 2), i[u] = m - i[s], Math.floor((e4 + m - o) / r + 1);
          }
        default:
          throw new Error("Unsupported AutoPad type");
      }
      else return Math.floor((e4 + i[s] + i[u] - c2) / r + 1);
    }
  }, Wr = class {
    static getShapeOfGemmResult(e4, r, n, o, i) {
      if (e4.length !== 2 || n.length !== 2) throw new Error("shape need to be of size 2");
      let s, u, d;
      r ? (s = e4[1], u = e4[0]) : (s = e4[0], u = e4[1]);
      let c2 = -1;
      if (o ? (d = n[0], c2 = 1) : (d = n[1], c2 = 0), n[c2] !== u) throw new Error("dimension mismatch");
      if (s <= 0 || d <= 0 || u <= 0) throw new Error("invalid shape specified");
      if (i && !ot.isValidBroadcast(i, [s, d])) throw new Error("gemm: invalid bias shape for broadcast");
      return [s, d, u];
    }
  }, As = -34028234663852886e22, Es = 34028234663852886e22;
});
var Gr;
var oo = V(() => {
  "use strict";
  J();
  Gr = (t, e4) => new (Wt(e4))(t);
});
var Ps;
var ao;
var Os;
var Rf;
var ks;
var Uf;
var zs;
var Hr;
var Fr;
var io;
var Bs;
var Ds = V(() => {
  "use strict";
  J();
  nt();
  Ps = /* @__PURE__ */ new Map([["float32", 32], ["float16", 16], ["int32", 32], ["uint32", 32], ["int64", 64], ["uint64", 64], ["int8", 8], ["uint8", 8], ["int4", 4], ["uint4", 4]]), ao = (t, e4) => {
    if (e4 === "int32") return t;
    let r = Ps.get(e4);
    if (!r) throw new Error(`WebNN backend does not support data type: ${e4}`);
    let n = r / 8;
    if (t.byteLength % n !== 0) throw new Error(`Invalid Uint8Array length - must be a multiple of ${n}.`);
    let o = t.byteLength / n, i = new (Wt(e4))(t.buffer, t.byteOffset, o);
    switch (e4) {
      case "int64":
      case "uint64": {
        let s = new Int32Array(o);
        for (let u = 0; u < o; u++) {
          let d = i[u];
          if (d > 2147483647n || d < -2147483648n) throw new Error("Can not convert int64 data to int32 - value out of range.");
          s[u] = Number(d);
        }
        return new Uint8Array(s.buffer);
      }
      case "int8":
      case "uint8":
      case "uint32": {
        if (e4 === "uint32" && i.some((u) => u > 2147483647)) throw new Error("Can not convert uint32 data to int32 - value out of range.");
        let s = Int32Array.from(i, Number);
        return new Uint8Array(s.buffer);
      }
      default:
        throw new Error(`Unsupported data conversion from ${e4} to 'int32'`);
    }
  }, Os = (t, e4) => {
    if (e4 === "int32") return t;
    if (t.byteLength % 4 !== 0) throw new Error("Invalid Uint8Array length - must be a multiple of 4 (int32).");
    let r = t.byteLength / 4, n = new Int32Array(t.buffer, t.byteOffset, r);
    switch (e4) {
      case "int64": {
        let o = BigInt64Array.from(n, BigInt);
        return new Uint8Array(o.buffer);
      }
      case "uint64": {
        if (n.some((i) => i < 0)) throw new Error("Can not convert int32 data to uin64 - negative value found.");
        let o = BigUint64Array.from(n, BigInt);
        return new Uint8Array(o.buffer);
      }
      case "int8": {
        if (n.some((i) => i < -128 || i > 127)) throw new Error("Can not convert int32 data to int8 - value out of range.");
        let o = Int8Array.from(n, Number);
        return new Uint8Array(o.buffer);
      }
      case "uint8": {
        if (n.some((o) => o < 0 || o > 255)) throw new Error("Can not convert int32 data to uint8 - value out of range.");
        return Uint8Array.from(n, Number);
      }
      case "uint32": {
        if (n.some((i) => i < 0)) throw new Error("Can not convert int32 data to uint32 - negative value found.");
        let o = Uint32Array.from(n, Number);
        return new Uint8Array(o.buffer);
      }
      default:
        throw new Error(`Unsupported data conversion from 'int32' to ${e4}`);
    }
  }, Rf = 1, ks = () => Rf++, Uf = /* @__PURE__ */ new Map([["int8", "int32"], ["uint8", "int32"], ["uint32", "int32"], ["int64", "int32"]]), zs = (t, e4) => {
    let r = Ps.get(t);
    if (!r) throw new Error(`WebNN backend does not support data type: ${t}`);
    return e4.length > 0 ? Math.ceil(e4.reduce((n, o) => n * o) * r / 8) : 0;
  }, Hr = class {
    constructor(e4) {
      this.isDataConverted = false;
      let { sessionId: r, context: n, tensor: o, dataType: i, shape: s, fallbackDataType: u } = e4;
      this.sessionId = r, this.mlContext = n, this.mlTensor = o, this.dataType = i, this.tensorShape = s, this.fallbackDataType = u;
    }
    get tensor() {
      return this.mlTensor;
    }
    get type() {
      return this.dataType;
    }
    get fallbackType() {
      return this.fallbackDataType;
    }
    get shape() {
      return this.tensorShape;
    }
    get byteLength() {
      return zs(this.dataType, this.tensorShape);
    }
    destroy() {
      ie("verbose", () => "[WebNN] TensorWrapper.destroy"), this.mlTensor.destroy();
    }
    write(e4) {
      this.mlContext.writeTensor(this.mlTensor, e4);
    }
    async read(e4) {
      if (this.fallbackDataType) {
        let r = await this.mlContext.readTensor(this.mlTensor), n = Os(new Uint8Array(r), this.dataType);
        if (e4) {
          (e4 instanceof ArrayBuffer ? new Uint8Array(e4) : new Uint8Array(e4.buffer, e4.byteOffset, e4.byteLength)).set(n);
          return;
        } else return new Uint8Array(n).buffer;
      } else return e4 ? this.mlContext.readTensor(this.mlTensor, e4) : this.mlContext.readTensor(this.mlTensor);
    }
    canReuseTensor(e4, r, n) {
      return this.mlContext === e4 && this.dataType === r && this.tensorShape.length === n.length && this.tensorShape.every((o, i) => o === n[i]);
    }
    setIsDataConverted(e4) {
      this.isDataConverted = e4;
    }
  }, Fr = class {
    constructor(e4, r) {
      this.tensorManager = e4;
      this.wrapper = r;
    }
    get tensorWrapper() {
      return this.wrapper;
    }
    releaseTensor() {
      this.tensorWrapper && (this.tensorManager.releaseTensor(this.tensorWrapper), this.wrapper = void 0);
    }
    async ensureTensor(e4, r, n, o) {
      let i = this.tensorManager.getMLContext(e4), s = this.tensorManager.getMLOpSupportLimits(e4), u;
      if (!s?.input.dataTypes.includes(r)) {
        if (u = Uf.get(r), !u || s?.input.dataTypes.includes(u)) throw new Error(`WebNN backend does not support data type: ${r}`);
        ie("verbose", () => `[WebNN] TensorIdTracker.ensureTensor: fallback dataType from ${r} to ${u}`);
      }
      if (this.wrapper) {
        if (this.wrapper.canReuseTensor(i, r, n)) return this.wrapper.tensor;
        if (o) {
          if (this.wrapper.byteLength !== zs(r, n)) throw new Error("Unable to copy data to tensor with different size.");
          this.activeUpload = new Uint8Array(await this.wrapper.read());
        }
        this.tensorManager.releaseTensor(this.wrapper);
      }
      let d = typeof MLTensorUsage > "u" ? void 0 : MLTensorUsage.READ | MLTensorUsage.WRITE;
      return this.wrapper = await this.tensorManager.getCachedTensor(e4, r, n, d, true, true, u), o && this.activeUpload && (this.wrapper.write(this.activeUpload), this.activeUpload = void 0), this.wrapper.tensor;
    }
    upload(e4) {
      let r = e4;
      if (this.wrapper) {
        if (this.wrapper.fallbackType) if (this.wrapper.fallbackType === "int32") r = ao(e4, this.wrapper.type), this.wrapper.setIsDataConverted(true);
        else throw new Error(`Unsupported fallback data type: ${this.wrapper.fallbackType}`);
        if (e4.byteLength === this.wrapper.byteLength) {
          this.wrapper.write(r);
          return;
        } else ie("verbose", () => "Data size does not match tensor size. Releasing tensor."), this.releaseTensor();
      }
      this.activeUpload ? this.activeUpload.set(r) : this.activeUpload = new Uint8Array(r);
    }
    async download(e4) {
      if (this.activeUpload) {
        let r = this.wrapper?.isDataConverted ? Os(this.activeUpload, this.wrapper?.type) : this.activeUpload;
        if (e4) {
          e4 instanceof ArrayBuffer ? new Uint8Array(e4).set(r) : new Uint8Array(e4.buffer, e4.byteOffset, e4.byteLength).set(r);
          return;
        } else return r.buffer;
      }
      if (!this.wrapper) throw new Error("Tensor has not been created.");
      return e4 ? this.wrapper.read(e4) : this.wrapper.read();
    }
  }, io = class {
    constructor(e4) {
      this.backend = e4;
      this.tensorTrackersById = /* @__PURE__ */ new Map();
      this.freeTensors = [];
      this.externalTensors = /* @__PURE__ */ new Set();
    }
    getMLContext(e4) {
      let r = this.backend.getMLContext(e4);
      if (!r) throw new Error("MLContext not found for session.");
      return r;
    }
    getMLOpSupportLimits(e4) {
      return this.backend.getMLOpSupportLimits(e4);
    }
    reserveTensorId() {
      let e4 = ks();
      return this.tensorTrackersById.set(e4, new Fr(this)), e4;
    }
    releaseTensorId(e4) {
      let r = this.tensorTrackersById.get(e4);
      r && (this.tensorTrackersById.delete(e4), r.tensorWrapper && this.releaseTensor(r.tensorWrapper));
    }
    async ensureTensor(e4, r, n, o, i) {
      ie("verbose", () => `[WebNN] TensorManager.ensureTensor {tensorId: ${r}, dataType: ${n}, shape: ${o}, copyOld: ${i}}`);
      let s = this.tensorTrackersById.get(r);
      if (!s) throw new Error("Tensor not found.");
      return s.ensureTensor(e4, n, o, i);
    }
    upload(e4, r) {
      let n = this.tensorTrackersById.get(e4);
      if (!n) throw new Error("Tensor not found.");
      n.upload(r);
    }
    async download(e4, r) {
      ie("verbose", () => `[WebNN] TensorManager.download {tensorId: ${e4}, dstBuffer: ${r?.byteLength}}`);
      let n = this.tensorTrackersById.get(e4);
      if (!n) throw new Error("Tensor not found.");
      return n.download(r);
    }
    releaseTensorsForSession(e4) {
      for (let r of this.freeTensors) r.sessionId === e4 && r.destroy();
      this.freeTensors = this.freeTensors.filter((r) => r.sessionId !== e4);
    }
    registerTensor(e4, r, n, o) {
      let i = this.getMLContext(e4), s = ks(), u = new Hr({ sessionId: e4, context: i, tensor: r, dataType: n, shape: o });
      return this.tensorTrackersById.set(s, new Fr(this, u)), this.externalTensors.add(u), s;
    }
    async getCachedTensor(e4, r, n, o, i, s, u) {
      let d = this.getMLContext(e4);
      for (let [p4, m] of this.freeTensors.entries()) if (m.canReuseTensor(d, r, n)) {
        ie("verbose", () => `[WebNN] Reusing tensor {dataType: ${r}, ${u ? `fallbackDataType: ${u},` : ""} shape: ${n}`);
        let g = this.freeTensors.splice(p4, 1)[0];
        return g.sessionId = e4, g;
      }
      ie("verbose", () => `[WebNN] MLContext.createTensor {dataType: ${r}, ${u ? `fallbackDataType: ${u},` : ""} shape: ${n}}`);
      let c2 = await d.createTensor({ dataType: u ?? r, shape: n, dimensions: n, usage: o, writable: i, readable: s });
      return new Hr({ sessionId: e4, context: d, tensor: c2, dataType: r, shape: n, fallbackDataType: u });
    }
    releaseTensor(e4) {
      this.externalTensors.has(e4) && this.externalTensors.delete(e4), this.freeTensors.push(e4);
    }
  }, Bs = (...t) => new io(...t);
});
var qr;
var Nf;
var Kr;
var Ms = V(() => {
  "use strict";
  J();
  vt();
  oo();
  Ds();
  nt();
  qr = /* @__PURE__ */ new Map([[1, "float32"], [10, "float16"], [6, "int32"], [12, "uint32"], [7, "int64"], [13, "uint64"], [22, "int4"], [21, "uint4"], [3, "int8"], [2, "uint8"], [9, "uint8"]]), Nf = (t, e4) => {
    if (t === e4) return true;
    if (t === void 0 || e4 === void 0) return false;
    let r = Object.keys(t).sort(), n = Object.keys(e4).sort();
    return r.length === n.length && r.every((o, i) => o === n[i] && t[o] === e4[o]);
  }, Kr = class {
    constructor(e4) {
      this.tensorManager = Bs(this);
      this.mlContextBySessionId = /* @__PURE__ */ new Map();
      this.sessionIdsByMLContext = /* @__PURE__ */ new Map();
      this.mlContextCache = [];
      this.sessionGraphInputs = /* @__PURE__ */ new Map();
      this.sessionGraphOutputs = /* @__PURE__ */ new Map();
      this.temporaryGraphInputs = [];
      this.temporaryGraphOutputs = [];
      this.temporarySessionTensorIds = /* @__PURE__ */ new Map();
      this.mlOpSupportLimitsBySessionId = /* @__PURE__ */ new Map();
      Lr(e4.logLevel, !!e4.debug);
    }
    get currentSessionId() {
      if (this.activeSessionId === void 0) throw new Error("No active session");
      return this.activeSessionId;
    }
    onRunStart(e4) {
      ie("verbose", () => `[WebNN] onRunStart {sessionId: ${e4}}`), this.activeSessionId = e4;
    }
    onRunEnd(e4) {
      ie("verbose", () => `[WebNN] onRunEnd {sessionId: ${e4}}`);
      let r = this.temporarySessionTensorIds.get(e4);
      if (r) {
        for (let n of r) ie("verbose", () => `[WebNN] releasing temporary tensor {tensorId: ${n}}`), this.tensorManager.releaseTensorId(n);
        this.temporarySessionTensorIds.delete(e4), this.activeSessionId = void 0;
      }
    }
    async createMLContext(e4) {
      if (e4 instanceof GPUDevice) {
        let n = this.mlContextCache.findIndex((o) => o.gpuDevice === e4);
        if (n !== -1) return this.mlContextCache[n].mlContext;
        {
          let o = await navigator.ml.createContext(e4);
          return this.mlContextCache.push({ gpuDevice: e4, mlContext: o }), o;
        }
      } else if (e4 === void 0) {
        let n = this.mlContextCache.findIndex((o) => o.options === void 0 && o.gpuDevice === void 0);
        if (n !== -1) return this.mlContextCache[n].mlContext;
        {
          let o = await navigator.ml.createContext();
          return this.mlContextCache.push({ mlContext: o }), o;
        }
      }
      let r = this.mlContextCache.findIndex((n) => Nf(n.options, e4));
      if (r !== -1) return this.mlContextCache[r].mlContext;
      {
        let n = await navigator.ml.createContext(e4);
        return this.mlContextCache.push({ options: e4, mlContext: n }), n;
      }
    }
    registerMLContext(e4, r) {
      this.mlContextBySessionId.set(e4, r);
      let n = this.sessionIdsByMLContext.get(r);
      n || (n = /* @__PURE__ */ new Set(), this.sessionIdsByMLContext.set(r, n)), n.add(e4), this.mlOpSupportLimitsBySessionId.has(e4) || this.mlOpSupportLimitsBySessionId.set(e4, r.opSupportLimits()), this.temporaryGraphInputs.length > 0 && (this.sessionGraphInputs.set(e4, this.temporaryGraphInputs), this.temporaryGraphInputs = []), this.temporaryGraphOutputs.length > 0 && (this.sessionGraphOutputs.set(e4, this.temporaryGraphOutputs), this.temporaryGraphOutputs = []);
    }
    onReleaseSession(e4) {
      this.sessionGraphInputs.delete(e4), this.sessionGraphOutputs.delete(e4);
      let r = this.mlContextBySessionId.get(e4);
      if (!r) return;
      this.tensorManager.releaseTensorsForSession(e4), this.mlContextBySessionId.delete(e4), this.mlOpSupportLimitsBySessionId.delete(e4);
      let n = this.sessionIdsByMLContext.get(r);
      if (n.delete(e4), n.size === 0) {
        this.sessionIdsByMLContext.delete(r);
        let o = this.mlContextCache.findIndex((i) => i.mlContext === r);
        o !== -1 && this.mlContextCache.splice(o, 1);
      }
    }
    getMLContext(e4) {
      return this.mlContextBySessionId.get(e4);
    }
    getMLOpSupportLimits(e4) {
      return this.mlOpSupportLimitsBySessionId.get(e4);
    }
    reserveTensorId() {
      return this.tensorManager.reserveTensorId();
    }
    releaseTensorId(e4) {
      ie("verbose", () => `[WebNN] releaseTensorId {tensorId: ${e4}}`), this.tensorManager.releaseTensorId(e4);
    }
    async ensureTensor(e4, r, n, o, i) {
      let s = qr.get(n);
      if (!s) throw new Error(`Unsupported ONNX data type: ${n}`);
      return this.tensorManager.ensureTensor(e4 ?? this.currentSessionId, r, s, o, i);
    }
    async createTemporaryTensor(e4, r, n) {
      ie("verbose", () => `[WebNN] createTemporaryTensor {onnxDataType: ${r}, shape: ${n}}`);
      let o = qr.get(r);
      if (!o) throw new Error(`Unsupported ONNX data type: ${r}`);
      let i = this.tensorManager.reserveTensorId();
      await this.tensorManager.ensureTensor(e4, i, o, n, false);
      let s = this.temporarySessionTensorIds.get(e4);
      return s ? s.push(i) : this.temporarySessionTensorIds.set(e4, [i]), i;
    }
    uploadTensor(e4, r) {
      if (!ye().shouldTransferToMLTensor) throw new Error("Trying to upload to a MLTensor while shouldTransferToMLTensor is false");
      ie("verbose", () => `[WebNN] uploadTensor {tensorId: ${e4}, data: ${r.byteLength}}`), this.tensorManager.upload(e4, r);
    }
    async downloadTensor(e4, r) {
      return this.tensorManager.download(e4, r);
    }
    createMLTensorDownloader(e4, r) {
      return async () => {
        let n = await this.tensorManager.download(e4);
        return Gr(n, r);
      };
    }
    registerMLTensor(e4, r, n, o) {
      let i = qr.get(n);
      if (!i) throw new Error(`Unsupported ONNX data type: ${n}`);
      let s = this.tensorManager.registerTensor(e4, r, i, o);
      return ie("verbose", () => `[WebNN] registerMLTensor {tensor: ${r}, dataType: ${i}, dimensions: ${o}} -> {tensorId: ${s}}`), s;
    }
    registerMLConstant(e4, r, n, o, i, s, u = false) {
      if (!s) throw new Error("External mounted files are not available.");
      let d = e4;
      e4.startsWith("./") && (d = e4.substring(2));
      let c2 = s.get(d);
      if (!c2) throw new Error(`File with name ${d} not found in preloaded files.`);
      if (r + n > c2.byteLength) throw new Error("Out of bounds: data offset and length exceed the external file data size.");
      let p4 = c2.slice(r, r + n).buffer, m;
      switch (i.dataType) {
        case "float32":
          m = new Float32Array(p4);
          break;
        case "float16":
          m = typeof Float16Array < "u" ? new Float16Array(p4) : new Uint16Array(p4);
          break;
        case "int32":
          m = new Int32Array(p4);
          break;
        case "uint32":
          m = new Uint32Array(p4);
          break;
        case "int64":
          if (u) {
            let g = ao(new Uint8Array(p4), "int64");
            m = new Int32Array(g.buffer), i.dataType = "int32";
          } else m = new BigInt64Array(p4);
          break;
        case "uint64":
          m = new BigUint64Array(p4);
          break;
        case "int8":
          m = new Int8Array(p4);
          break;
        case "int4":
        case "uint4":
        case "uint8":
          m = new Uint8Array(p4);
          break;
        default:
          throw new Error(`Unsupported data type: ${i.dataType} in creating WebNN Constant from external data.`);
      }
      return ie("verbose", () => `[WebNN] registerMLConstant {dataType: ${i.dataType}, shape: ${i.shape}}} ${u ? "(Note: it was int64 data type and registered to int32 as workaround)" : ""}`), o.constant(i, m);
    }
    registerGraphInput(e4) {
      this.temporaryGraphInputs.push(e4);
    }
    registerGraphOutput(e4) {
      this.temporaryGraphOutputs.push(e4);
    }
    isGraphInput(e4, r) {
      let n = this.sessionGraphInputs.get(e4);
      return n ? n.includes(r) : false;
    }
    isGraphOutput(e4, r) {
      let n = this.sessionGraphOutputs.get(e4);
      return n ? n.includes(r) : false;
    }
    isGraphInputOutputTypeSupported(e4, r, n = true) {
      let o = qr.get($t(r)), i = this.mlOpSupportLimitsBySessionId.get(e4);
      return typeof o > "u" ? false : n ? !!i?.input.dataTypes.includes(o) : !!i?.output.dataTypes.includes(o);
    }
    flush() {
    }
  };
});
var jr = V(() => {
  "use strict";
});
var Rs;
var so;
var uo;
var Vf;
var Lf;
var Us;
var co;
var lo;
var Vs;
var Ls = V(() => {
  "use strict";
  nt();
  jr();
  Rs = /* @__PURE__ */ new Map([[64, 250], [128, 200], [256, 200], [512, 200], [2048, 230], [4096, 200], [8192, 50], [16384, 50], [32768, 50], [65536, 50], [131072, 50], [262144, 50], [524288, 50], [1048576, 50], [2097152, 30], [4194304, 20], [8388608, 10], [12582912, 10], [16777216, 10], [26214400, 15], [33554432, 22], [44236800, 2], [58982400, 6], [67108864, 6], [134217728, 6], [167772160, 6]]), so = [], uo = (t) => Math.ceil(Number(t) / 16) * 16, Vf = (t) => {
    for (let e4 = 0; e4 < so.length; e4++) {
      let r = so[e4];
      if (t <= r) return r;
    }
    return Math.ceil(t / 16) * 16;
  }, Lf = 1, Us = () => Lf++, co = async (t, e4, r, n) => {
    let o = uo(r), i = t.device.createBuffer({ size: o, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      let s = t.getCommandEncoder();
      t.endComputePass(), s.copyBufferToBuffer(e4, 0, i, 0, o), t.flush(), await i.mapAsync(GPUMapMode.READ);
      let u = i.getMappedRange();
      if (n) {
        let d = n();
        return d.set(new Uint8Array(u, 0, r)), d;
      } else return new Uint8Array(u.slice(0, r));
    } finally {
      i.destroy();
    }
  }, lo = class {
    constructor(e4) {
      this.backend = e4;
      this.storageCache = /* @__PURE__ */ new Map(), this.freeBuffers = /* @__PURE__ */ new Map(), this.freeUniformBuffers = /* @__PURE__ */ new Map(), this.buffersPending = [], this.capturedPendingBuffers = /* @__PURE__ */ new Map();
      for (let [r] of Rs) so.push(r), this.freeBuffers.set(r, []), this.freeUniformBuffers.set(r, []);
      this.sessionCount = 0;
    }
    upload(e4, r) {
      let n = r.buffer, o = r.byteOffset, i = r.byteLength, s = uo(i), u = this.storageCache.get(e4);
      if (!u) throw new Error("gpu data for uploading does not exist");
      if (Number(u.originalSize) !== i) throw new Error(`inconsistent data size. gpu data size=${u.originalSize}, data size=${i}`);
      let d = this.backend.device.createBuffer({ mappedAtCreation: true, size: s, usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC }), c2 = d.getMappedRange();
      new Uint8Array(c2).set(new Uint8Array(n, o, i)), d.unmap();
      let p4 = this.backend.device.createCommandEncoder();
      p4.copyBufferToBuffer(d, 0, u.gpuData.buffer, 0, s), this.backend.device.queue.submit([p4.finish()]), d.destroy(), ie("verbose", () => `[WebGPU] GpuDataManager.upload(id=${e4})`);
    }
    memcpy(e4, r) {
      let n = this.storageCache.get(e4);
      if (!n) throw new Error("source gpu data for memcpy does not exist");
      let o = this.storageCache.get(r);
      if (!o) throw new Error("destination gpu data for memcpy does not exist");
      if (n.originalSize !== o.originalSize) throw new Error("inconsistent source and destination gpu data size");
      let i = uo(n.originalSize), s = this.backend.getCommandEncoder();
      this.backend.endComputePass(), s.copyBufferToBuffer(n.gpuData.buffer, 0, o.gpuData.buffer, 0, i);
    }
    registerExternalBuffer(e4, r, n) {
      let o;
      if (n) {
        if (o = n[0], e4 === n[1]) return ie("verbose", () => `[WebGPU] GpuDataManager.registerExternalBuffer(size=${r}) => id=${o}, buffer is the same, skip.`), o;
        if (this.backend.capturedCommandList.has(this.backend.currentSessionId)) throw new Error(`Registering a different external buffer under graph capture mode is not supported yet.
             Please use the previous external buffer!`);
      } else o = Us();
      return this.storageCache.set(o, { gpuData: { id: o, type: 0, buffer: e4 }, originalSize: r }), ie("verbose", () => `[WebGPU] GpuDataManager.registerExternalBuffer(size=${r}) => id=${o}, registered.`), o;
    }
    unregisterExternalBuffer(e4) {
      e4 !== void 0 && (this.storageCache.delete(e4), ie("verbose", () => `[WebGPU] GpuDataManager.unregisterExternalBuffer() => id=${e4}`));
    }
    create(e4, r = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST) {
      let n = Vf(e4), o, i = (r & GPUBufferUsage.STORAGE) === GPUBufferUsage.STORAGE, s = (r & GPUBufferUsage.UNIFORM) === GPUBufferUsage.UNIFORM;
      if (i || s) {
        let c2 = (i ? this.freeBuffers : this.freeUniformBuffers).get(n);
        c2 ? c2.length > 0 ? o = c2.pop() : o = this.backend.device.createBuffer({ size: n, usage: r }) : o = this.backend.device.createBuffer({ size: n, usage: r });
      } else o = this.backend.device.createBuffer({ size: n, usage: r });
      let u = { id: Us(), type: 0, buffer: o };
      return this.storageCache.set(u.id, { gpuData: u, originalSize: Number(e4) }), ie("verbose", () => `[WebGPU] GpuDataManager.create(size=${e4}) => id=${u.id}`), u;
    }
    get(e4) {
      return this.storageCache.get(e4)?.gpuData;
    }
    release(e4) {
      let r = typeof e4 == "bigint" ? Number(e4) : e4, n = this.storageCache.get(r);
      if (!n) {
        if (this.storageCache.size === 0) return 0;
        throw new Error("releasing data does not exist");
      }
      return ie("verbose", () => `[WebGPU] GpuDataManager.release(id=${r}), gpuDataId=${n.gpuData.id}`), this.storageCache.delete(r), this.buffersPending.push(n.gpuData.buffer), n.originalSize;
    }
    async download(e4, r) {
      let n = this.storageCache.get(Number(e4));
      if (!n) throw new Error("data does not exist");
      await co(this.backend, n.gpuData.buffer, n.originalSize, r);
    }
    refreshPendingBuffers() {
      if (this.buffersPending.length !== 0) if (this.backend.sessionStatus === "default") {
        for (let e4 of this.buffersPending) {
          let r = Rs.get(e4.size);
          if ((e4.usage & GPUBufferUsage.STORAGE) === GPUBufferUsage.STORAGE) {
            let n = this.freeBuffers.get(e4.size) || [];
            r === void 0 || n.length >= r ? e4.destroy() : n.push(e4);
          } else if ((e4.usage & GPUBufferUsage.UNIFORM) === GPUBufferUsage.UNIFORM) {
            let n = this.freeUniformBuffers.get(e4.size) || [];
            r === void 0 || n.length >= r ? e4.destroy() : n.push(e4);
          } else e4.destroy();
        }
        this.buffersPending = [];
      } else {
        let e4 = this.capturedPendingBuffers.get(this.backend.currentSessionId);
        e4 || (e4 = [], this.capturedPendingBuffers.set(this.backend.currentSessionId, e4));
        for (let r of this.buffersPending) e4.push(r);
        this.buffersPending = [];
      }
    }
    dispose() {
      this.freeBuffers.forEach((e4) => {
        e4.forEach((r) => {
          r.destroy();
        });
      }), this.freeUniformBuffers.forEach((e4) => {
        e4.forEach((r) => {
          r.destroy();
        });
      }), this.storageCache.forEach((e4) => {
        e4.gpuData.buffer.destroy();
      }), this.capturedPendingBuffers.forEach((e4) => {
        e4.forEach((r) => {
          r.destroy();
        });
      }), this.storageCache = /* @__PURE__ */ new Map(), this.freeBuffers = /* @__PURE__ */ new Map(), this.freeUniformBuffers = /* @__PURE__ */ new Map(), this.capturedPendingBuffers = /* @__PURE__ */ new Map();
    }
    onCreateSession() {
      this.sessionCount += 1;
    }
    onReleaseSession(e4) {
      let r = this.capturedPendingBuffers.get(e4);
      r && (r.forEach((n) => {
        n.destroy();
      }), this.capturedPendingBuffers.delete(e4)), this.sessionCount -= 1, this.sessionCount === 0 && (ie("warning", () => "[WebGPU] Clearing webgpu buffer cache"), this.storageCache.forEach((n) => {
        n.gpuData.buffer.destroy();
      }), this.storageCache = /* @__PURE__ */ new Map());
    }
  }, Vs = (...t) => new lo(...t);
});
var po;
var ee;
var Ce = V(() => {
  "use strict";
  po = class {
    constructor(e4) {
      Object.assign(this, e4);
    }
    get cacheKey() {
      return this.key || (this.key = Object.getOwnPropertyNames(this).sort().map((e4) => `${this[e4]}`).join(";")), this.key;
    }
  }, ee = (t) => new po(t);
});
var Bt;
var fo;
var we;
var ze;
var W;
var fe;
var ho;
var Dt;
var Ze;
var j;
var Zr;
var O;
var U;
var Ws;
var Qr;
var mo;
var Gs;
var oe = V(() => {
  "use strict";
  J();
  re();
  Bt = 64, fo = (t, e4) => {
    if (e4 === 3) throw new Error("vec3 has same alignment as vec4, use vec4 instead");
    switch (Number(t)) {
      case 10:
        return e4 > 1 ? `vec${e4}<f16>` : "f16";
      case 1:
        return e4 > 1 ? `vec${e4}<f32>` : "f32";
      case 6:
        return e4 > 1 ? `vec${e4}<i32>` : "i32";
      case 12:
        return e4 > 1 ? `vec${e4}<u32>` : "u32";
      case 7:
        if (e4 > 1) throw new Error("currently not supported vecX of uint64 yet");
        return ["vec2<u32>", "i32"];
      case 13:
        if (e4 > 1) throw new Error("currently not supported vecX of uint64 yet");
        return ["vec2<u32>", "u32"];
      case 9:
        if (e4 !== 4) throw new Error("bool must be vec4");
        return ["u32", "vec4<bool>"];
      case 22:
        return "i32";
      case 21:
        return "u32";
      default:
        throw new Error(`Unknown data type: ${t}`);
    }
  }, we = (t, e4 = 1) => {
    let r = fo(t, e4);
    return typeof r == "string" ? r : r[0];
  }, ze = (t, e4 = 1) => {
    let r = fo(t, e4);
    return typeof r == "string" ? r : r[1];
  }, W = (...t) => {
    let e4 = [];
    return t.forEach((r) => {
      r.length !== 0 && e4.push({ type: 12, data: r }, { type: 12, data: k4.computeStrides(r) });
    }), e4;
  }, fe = (t) => t % 4 === 0 ? 4 : t % 2 === 0 ? 2 : 1, ho = (t = "f32", e4, r = "0") => !e4 || e4 === 1 ? `${t}(${r})` : `vec${e4}<${t}>(${r})`, Dt = (t, e4, r) => t === "f32" ? r : e4 === 1 ? `f32(${r})` : `vec${e4}<f32>(${r})`, Ze = (t, e4) => e4 === 4 ? `(${t}.x + ${t}.y + ${t}.z + ${t}.w)` : e4 === 2 ? `(${t}.x + ${t}.y)` : e4 === 3 ? `(${t}.x + ${t}.y + ${t}.z)` : t, j = (t, e4, r, n) => t.startsWith("uniforms.") && r > 4 ? typeof e4 == "string" ? n === "f16" ? `${t}[(${e4}) / 8][(${e4}) % 8 / 4][(${e4}) % 8 % 4]` : `${t}[(${e4}) / 4][(${e4}) % 4]` : n === "f16" ? `${t}[${Math.floor(e4 / 8)}][${Math.floor(e4 % 8 / 4)}][${e4 % 8 % 4}]` : `${t}[${Math.floor(e4 / 4)}][${e4 % 4}]` : r > 1 ? `${t}[${e4}]` : t, Zr = (t, e4, r, n, o) => {
    let i = typeof r == "number", s = i ? r : r.length, u = [...new Array(s).keys()], d = s < 2 ? "u32" : s <= 4 ? `vec${s}<u32>` : `array<u32, ${s}>`, c2 = fo(e4, o), p4 = typeof c2 == "string" ? c2 : c2[1], m = typeof c2 == "string" ? c2 : c2[0], g = { indices: d, value: p4, storage: m, tensor: e4 }, y = (M3) => typeof M3 == "string" ? M3 : `${M3}u`, b = { offsetToIndices: false, indicesToOffset: false, broadcastedIndicesToOffset: false, set: false, setByIndices: false, get: false, getByIndices: false }, _ = i ? "uniforms." : "", T = `${_}${t}_shape`, x = `${_}${t}_strides`, $ = "";
    for (let M3 = 0; M3 < s - 1; M3++) $ += `
    let dim${M3} = current / ${j(x, M3, s)};
    let rest${M3} = current % ${j(x, M3, s)};
    indices[${M3}] = dim${M3};
    current = rest${M3};
    `;
    $ += `indices[${s - 1}] = current;`;
    let S = s < 2 ? "" : `
  fn o2i_${t}(offset: u32) -> ${g.indices} {
    var indices: ${g.indices};
    var current = offset;
    ${$}
    return indices;
  }`, I = (M3) => (b.offsetToIndices = true, s < 2 ? M3 : `o2i_${t}(${M3})`), E = [];
    if (s >= 2) for (let M3 = s - 1; M3 >= 0; M3--) E.push(`${j(x, M3, s)} * (indices[${M3}])`);
    let A = s < 2 ? "" : `
  fn i2o_${t}(indices: ${g.indices}) -> u32 {
    return ${E.join("+")};
  }`, z = (M3) => (b.indicesToOffset = true, s < 2 ? M3 : `i2o_${t}(${M3})`), v = (...M3) => s === 0 ? "0u" : `${g.indices}(${M3.map(y).join(",")})`, R = (M3, G) => s < 2 ? `${M3}` : `${j(M3, G, s)}`, N = (M3, G, be) => s < 2 ? `${M3}=${be};` : `${j(M3, G, s)}=${be};`, F = {}, q = (M3, G) => {
      b.broadcastedIndicesToOffset = true;
      let be = `${G.name}broadcastedIndicesTo${t}Offset`;
      if (be in F) return `${be}(${M3})`;
      let Ee = [];
      for (let $e = s - 1; $e >= 0; $e--) {
        let Pe = G.indicesGet("outputIndices", $e + G.rank - s);
        Ee.push(`${R(x, $e)} * (${Pe} % ${R(T, $e)})`);
      }
      return F[be] = `fn ${be}(outputIndices: ${G.type.indices}) -> u32 {
             return ${Ee.length > 0 ? Ee.join("+") : "0u"};
           }`, `${be}(${M3})`;
    }, X = (M3, G) => (() => {
      if (g.storage === g.value) return `${t}[${M3}]=${G};`;
      if (g.storage === "vec2<u32>" && g.value === "i32") return `${t}[${M3}]=vec2<u32>(u32(${G}), select(0u, 0xFFFFFFFFu, ${G} < 0));`;
      if (g.storage === "vec2<u32>" && g.value === "u32") return `${t}[${M3}]=vec2<u32>(u32(${G}), 0u);`;
      if (g.storage === "u32" && g.value === "vec4<bool>") return `${t}[${M3}]=dot(vec4<u32>(0x1, 0x100, 0x10000, 0x1000000), vec4<u32>(${G}));`;
      throw new Error(`not supported combination of storage type ${g.storage} and value type ${g.value} yet`);
    })(), B = (M3) => (() => {
      if (g.storage === g.value) return `${t}[${M3}]`;
      if (g.storage === "vec2<u32>" && g.value === "i32") return `i32(${t}[${M3}].x)`;
      if (g.storage === "vec2<u32>" && g.value === "u32") return `u32(${t}[${M3}].x)`;
      if (g.storage === "u32" && g.value === "vec4<bool>") return `vec4<bool>(bool(${t}[${M3}] & 0xFFu), bool(${t}[${M3}] & 0xFF00u), bool(${t}[${M3}] & 0xFF0000u), bool(${t}[${M3}] & 0xFF000000u))`;
      throw new Error(`not supported combination of storage type ${g.storage} and value type ${g.value} yet`);
    })(), L = s < 2 ? "" : `
  fn get_${t}ByIndices(indices: ${g.indices}) -> ${p4} {
    return ${B(`i2o_${t}(indices)`)};
  }`, Q = s < 2 ? "" : (() => {
      let M3 = u.map((be) => `d${be}: u32`).join(", "), G = u.map((be) => `d${be}`).join(", ");
      return `
  fn get_${t}(${M3}) -> ${p4} {
    return get_${t}ByIndices(${v(G)});
  }`;
    })(), Y = (...M3) => {
      if (M3.length !== s) throw new Error(`indices length must be ${s}`);
      let G = M3.map(y).join(",");
      return s === 0 ? B("0u") : s === 1 ? B(G[0]) : (b.get = true, b.getByIndices = true, b.indicesToOffset = true, `get_${t}(${G})`);
    }, Z = (M3) => s < 2 ? B(M3) : (b.getByIndices = true, b.indicesToOffset = true, `get_${t}ByIndices(${M3})`), te = s < 2 ? "" : `
  fn set_${t}ByIndices(indices: ${g.indices}, value: ${p4}) {
    ${X(`i2o_${t}(indices)`, "value")}
  }`, ae = s < 2 ? "" : (() => {
      let M3 = u.map((be) => `d${be}: u32`).join(", "), G = u.map((be) => `d${be}`).join(", ");
      return `
  fn set_${t}(${M3}, value: ${p4}) {
    set_${t}ByIndices(${v(G)}, value);
  }`;
    })();
    return { impl: () => {
      let M3 = [], G = false;
      return b.offsetToIndices && (M3.push(S), G = true), b.indicesToOffset && (M3.push(A), G = true), b.broadcastedIndicesToOffset && (Object.values(F).forEach((be) => M3.push(be)), G = true), b.set && (M3.push(ae), G = true), b.setByIndices && (M3.push(te), G = true), b.get && (M3.push(Q), G = true), b.getByIndices && (M3.push(L), G = true), !i && G && M3.unshift(`const ${T} = ${g.indices}(${r.join(",")});`, `const ${x} = ${g.indices}(${k4.computeStrides(r).join(",")});`), M3.join(`
`);
    }, type: g, offsetToIndices: I, indicesToOffset: z, broadcastedIndicesToOffset: q, indices: v, indicesGet: R, indicesSet: N, set: (...M3) => {
      if (M3.length !== s + 1) throw new Error(`indices length must be ${s}`);
      let G = M3[s];
      if (typeof G != "string") throw new Error("value must be string");
      let be = M3.slice(0, s).map(y).join(",");
      return s === 0 ? X("0u", G) : s === 1 ? X(be[0], G) : (b.set = true, b.setByIndices = true, b.indicesToOffset = true, `set_${t}(${be}, ${G})`);
    }, setByOffset: X, setByIndices: (M3, G) => s < 2 ? X(M3, G) : (b.setByIndices = true, b.indicesToOffset = true, `set_${t}ByIndices(${M3}, ${G});`), get: Y, getByOffset: B, getByIndices: Z, usage: n, name: t, strides: x, shape: T, rank: s };
  }, O = (t, e4, r, n = 1) => Zr(t, e4, r, "input", n), U = (t, e4, r, n = 1) => Zr(t, e4, r, "output", n), Ws = (t, e4, r) => Zr(t, e4, r, "atomicOutput", 1), Qr = (t, e4, r, n = 1) => Zr(t, e4, r, "internal", n), mo = class {
    constructor(e4, r) {
      this.normalizedDispatchGroup = e4;
      this.limits = r;
      this.internalVariables = [];
      this.variables = [];
      this.uniforms = [];
      this.variableIndex = 0;
    }
    guardAgainstOutOfBoundsWorkgroupSizes(e4) {
      return `if (global_idx >= ${typeof e4 == "number" ? `${e4}u` : e4}) { return; }`;
    }
    mainStart(e4 = Bt) {
      let r = typeof e4 == "number" ? e4 : e4[0], n = typeof e4 == "number" ? 1 : e4[1], o = typeof e4 == "number" ? 1 : e4[2];
      if (r > this.limits.maxComputeWorkgroupSizeX || n > this.limits.maxComputeWorkgroupSizeY || o > this.limits.maxComputeWorkgroupSizeZ) throw new Error(`workgroup size [${r}, ${n}, ${o}] exceeds the maximum workgroup size [${this.limits.maxComputeWorkgroupSizeX}, ${this.limits.maxComputeWorkgroupSizeY}, ${this.limits.maxComputeWorkgroupSizeZ}].`);
      if (r * n * o > this.limits.maxComputeInvocationsPerWorkgroup) throw new Error(`workgroup size [${r}, ${n}, ${o}] exceeds the maximum workgroup invocations ${this.limits.maxComputeInvocationsPerWorkgroup}.`);
      let i = this.normalizedDispatchGroup[1] === 1 && this.normalizedDispatchGroup[2] === 1, s = i ? `@builtin(global_invocation_id) global_id : vec3<u32>,
    @builtin(workgroup_id) workgroup_id : vec3<u32>,
    @builtin(local_invocation_index) local_idx : u32,
    @builtin(local_invocation_id) local_id : vec3<u32>` : `@builtin(global_invocation_id) global_id : vec3<u32>,
                                             @builtin(local_invocation_id) local_id : vec3<u32>,
    @builtin(local_invocation_index) local_idx : u32,
    @builtin(workgroup_id) workgroup_id : vec3<u32>,
    @builtin(num_workgroups) num_workgroups : vec3<u32>`, u = i ? `let global_idx = global_id.x;
         let workgroup_index = workgroup_id.x;` : `let workgroup_index = workgroup_id.z * num_workgroups[0] * num_workgroups[1] +
             workgroup_id.y * num_workgroups[0] + workgroup_id.x;
         let global_idx = workgroup_index * ${r * n * o}u + local_idx;`;
      return `@compute @workgroup_size(${r}, ${n}, ${o})
  fn main(${s}) {
    ${u}
  `;
    }
    appendVariableUniforms(e4) {
      e4.rank !== 0 && (e4.shape.startsWith("uniforms.") && this.uniforms.push({ name: e4.shape.replace("uniforms.", ""), type: "u32", length: e4.rank }), e4.strides.startsWith("uniforms.") && this.uniforms.push({ name: e4.strides.replace("uniforms.", ""), type: "u32", length: e4.rank }));
    }
    declareVariable(e4, r) {
      if (e4.usage === "internal") throw new Error("cannot use internal variable with declareVariable(). use registerInternalVariables() instead.");
      this.variables.push(e4), this.appendVariableUniforms(e4);
      let n = e4.usage === "input" ? "read" : "read_write", o = e4.usage === "atomicOutput" ? "atomic<i32>" : e4.type.storage;
      return `@group(0) @binding(${r}) var<storage, ${n}> ${e4.name}: array<${o}>;`;
    }
    declareVariables(...e4) {
      return e4.map((r) => this.declareVariable(r, this.variableIndex++)).join(`
`);
    }
    registerInternalVariable(e4) {
      if (e4.usage !== "internal") throw new Error("cannot use input or output variable with registerInternalVariable(). use declareVariables() instead.");
      this.internalVariables.push(e4), this.appendVariableUniforms(e4);
    }
    registerInternalVariables(...e4) {
      return e4.forEach((r) => this.registerInternalVariable(r)), this;
    }
    registerUniform(e4, r, n = 1) {
      return this.uniforms.push({ name: e4, type: r, length: n }), this;
    }
    registerUniforms(e4) {
      return this.uniforms = this.uniforms.concat(e4), this;
    }
    uniformDeclaration() {
      if (this.uniforms.length === 0) return "";
      let e4 = [];
      for (let { name: r, type: n, length: o } of this.uniforms) if (o && o > 4) n === "f16" ? e4.push(`@align(16) ${r}:array<mat2x4<${n}>, ${Math.ceil(o / 8)}>`) : e4.push(`${r}:array<vec4<${n}>, ${Math.ceil(o / 4)}>`);
      else {
        let i = o == null || o === 1 ? n : `vec${o}<${n}>`;
        e4.push(`${r}:${i}`);
      }
      return `
      struct Uniforms { ${e4.join(", ")} };
      @group(0) @binding(${this.variableIndex}) var<uniform> uniforms: Uniforms;`;
    }
    get additionalImplementations() {
      return this.uniformDeclaration() + this.variables.map((e4) => e4.impl()).join(`
`) + this.internalVariables.map((e4) => e4.impl()).join(`
`);
    }
    get variablesInfo() {
      if (this.uniforms.length === 0) return;
      let e4 = (r) => [12, 10, 1, 6][["u32", "f16", "f32", "i32"].indexOf(r)];
      return this.uniforms.map((r) => [e4(r.type), r.length ?? 1]);
    }
  }, Gs = (t, e4) => new mo(t, e4);
});
var Wf;
var Hs;
var Gf;
var Hf;
var Ff;
var qf;
var Be;
var Fs;
var qs;
var pt = V(() => {
  "use strict";
  J();
  re();
  Ce();
  oe();
  Wf = (t, e4) => {
    if (!t || t.length !== 1) throw new Error("Transpose requires 1 input.");
    if (e4.length !== 0 && e4.length !== t[0].dims.length) throw new Error(`perm size ${e4.length} does not match input rank ${t[0].dims.length}`);
  }, Hs = (t, e4) => e4.length !== 0 ? e4 : [...new Array(t).keys()].reverse(), Gf = (t, e4) => k4.sortBasedOnPerm(t, Hs(t.length, e4)), Hf = (t, e4, r, n) => {
    let o = `fn perm(i: ${n.type.indices}) -> ${r.type.indices} {
    var a: ${r.type.indices};`;
    for (let i = 0; i < e4; ++i) o += `a[${t[i]}]=i[${i}];`;
    return o += "return a;}";
  }, Ff = (t, e4) => {
    let r = [], n = [];
    for (let o = 0; o < t.length; ++o) t[o] !== 1 && r.push(t[o]), t[e4[o]] !== 1 && n.push(e4[o]);
    return { newShape: r, newPerm: n };
  }, qf = (t, e4) => {
    let r = 0;
    for (let n = 0; n < t.length; ++n) if (e4[t[n]] !== 1) {
      if (t[n] < r) return false;
      r = t[n];
    }
    return true;
  }, Be = (t, e4) => {
    let r = t.dataType, n = t.dims.length, o = Hs(n, e4), i = Gf(t.dims, o), s = t.dims, u = i, d = n < 2 || qf(o, t.dims), c2;
    if (d) return c2 = (_) => {
      let T = O("input", r, s, 4), x = U("output", r, u, 4);
      return `
  ${_.registerUniform("output_size", "u32").declareVariables(T, x)}
  ${_.mainStart()}
    ${_.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    output[global_idx] = input[global_idx];
  }`;
    }, { name: "TransposeCopy", shaderCache: { inputDependencies: ["type"] }, getRunData: () => {
      let _ = k4.size(i);
      return { outputs: [{ dims: i, dataType: t.dataType }], dispatchGroup: { x: Math.ceil(_ / 64 / 4) }, programUniforms: [{ type: 12, data: Math.ceil(_ / 4) }] };
    }, getShaderSource: c2 };
    let { newShape: p4, newPerm: m } = Ff(t.dims, o), g = k4.areEqual(m, [2, 3, 1]), y = k4.areEqual(m, [3, 1, 2]);
    if (p4.length === 2 || g || y) {
      s = g ? [p4[0], p4[1] * p4[2]] : y ? [p4[0] * p4[1], p4[2]] : p4, u = [s[1], s[0]];
      let _ = 16;
      return c2 = (T) => {
        let x = O("a", r, s.length), $ = U("output", r, u.length);
        return `
  ${T.registerUniform("output_size", "u32").declareVariables(x, $)}
  var<workgroup> tile : array<array<${$.type.value}, ${_ + 1}>, ${_}>;
  ${T.mainStart([_, _, 1])}
    let stride = (uniforms.output_shape[1] - 1) / ${_} + 1;
    let workgroup_id_x = workgroup_index % stride;
    let workgroup_id_y = workgroup_index / stride;
    let input_col = workgroup_id_y * ${_}u + local_id.x;
    let input_row = workgroup_id_x * ${_}u + local_id.y;
    if (input_row < uniforms.a_shape[0] && input_col < uniforms.a_shape[1]) {
      tile[local_id.y][local_id.x] = ${x.getByIndices(`${x.type.indices}(input_row, input_col)`)};
    }
    workgroupBarrier();

    let output_col = workgroup_id_x * ${_}u + local_id.x;
    let output_row = workgroup_id_y * ${_}u + local_id.y;
    if (output_row < uniforms.output_shape[0] && output_col < uniforms.output_shape[1]) {
      ${$.setByIndices(`${$.type.indices}(output_row, output_col)`, "tile[local_id.x][local_id.y]")}
    }
  }`;
      }, { name: "TransposeShared", shaderCache: { inputDependencies: ["type"] }, getRunData: () => {
        let T = k4.size(i);
        return { outputs: [{ dims: i, dataType: t.dataType }], dispatchGroup: { x: Math.ceil(u[1] / _), y: Math.ceil(u[0] / _) }, programUniforms: [{ type: 12, data: T }, ...W(s, u)] };
      }, getShaderSource: c2 };
    }
    return c2 = (_) => {
      let T = O("a", r, s.length), x = U("output", r, u.length);
      return `
  ${_.registerUniform("output_size", "u32").declareVariables(T, x)}

  ${Hf(o, n, T, x)}

  ${_.mainStart()}
    ${_.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}

    let indices = ${x.offsetToIndices("global_idx")};
    let aIndices = perm(indices);

    ${x.setByOffset("global_idx", T.getByIndices("aIndices"))}
  }`;
    }, { name: "Transpose", shaderCache: { hint: `${e4}`, inputDependencies: ["rank"] }, getRunData: () => {
      let _ = k4.size(i);
      return { outputs: [{ dims: i, dataType: t.dataType }], dispatchGroup: { x: Math.ceil(_ / 64) }, programUniforms: [{ type: 12, data: _ }, ...W(s, u)] };
    }, getShaderSource: c2 };
  }, Fs = (t, e4) => {
    Wf(t.inputs, e4.perm), t.compute(Be(t.inputs[0], e4.perm));
  }, qs = (t) => ee({ perm: t.perm });
});
var Kf;
var jf;
var Zf;
var Qf;
var Yf;
var Xf;
var Jf;
var eh;
var th;
var rh;
var it;
var Ks;
var js;
var Zs;
var Qs;
var Ys;
var Xs;
var Js;
var eu;
var tu;
var ru;
var nu = V(() => {
  "use strict";
  J();
  re();
  oe();
  Yr();
  pt();
  Kf = { max: "select(bestValue, candidate, candidate > bestValue)", min: "select(bestValue, candidate, candidate < bestValue)", mean: "bestValue + candidate", sum: "bestValue + candidate", prod: "bestValue * candidate", sumSquare: "bestValue + candidate * candidate", logSumExp: "bestValue + exp(candidate)", l1: "bestValue + abs(candidate)", l2: "bestValue + candidate * candidate", logSum: "bestValue + candidate" }, jf = { max: "select(bestValue, candidate, candidate > bestValue)", min: "select(bestValue, candidate, candidate < bestValue)", mean: "bestValue + candidate", sum: "bestValue + candidate", prod: "bestValue * candidate", sumSquare: "bestValue + candidate", logSumExp: "bestValue + candidate", l1: "bestValue + candidate", l2: "bestValue + candidate", logSum: "bestValue + candidate" }, Zf = { max: "_A[offset]", min: "_A[offset]", mean: "0", sum: "0", prod: "1", sumSquare: "0", logSumExp: "0", l1: "0", l2: "0", logSum: "0" }, Qf = { max: "bestValue", min: "bestValue", sum: "bestValue", prod: "bestValue", sumSquare: "bestValue", logSumExp: "log(bestValue)", l1: "bestValue", l2: "sqrt(bestValue)", logSum: "log(bestValue)" }, Yf = (t, e4) => {
    let r = [];
    for (let n = e4 - t; n < e4; ++n) r.push(n);
    return r;
  }, Xf = (t, e4) => {
    let r = [], n = t.length;
    for (let i = 0; i < n; i++) e4.indexOf(i) === -1 && r.push(t[i]);
    let o = e4.map((i) => t[i]);
    return [r, o];
  }, Jf = (t, e4) => {
    let r = t.length + e4.length, n = [], o = 0;
    for (let i = 0; i < r; i++) e4.indexOf(i) === -1 ? n.push(t[o++]) : n.push(1);
    return n;
  }, eh = (t, e4) => {
    for (let r = 0; r < t.length; ++r) if (t[t.length - r - 1] !== e4 - 1 - r) return false;
    return true;
  }, th = (t, e4) => {
    let r = [];
    if (!eh(t, e4)) {
      for (let n = 0; n < e4; ++n) t.indexOf(n) === -1 && r.push(n);
      t.forEach((n) => r.push(n));
    }
    return r;
  }, rh = (t, e4, r, n, o, i, s) => {
    let u = r[0].dims, d = k4.size(i), c2 = k4.size(s), p4 = O("_A", r[0].dataType, u), m = U("output", o, i), g = 64;
    d === 1 && (g = 256);
    let y = `
          var<workgroup> aBestValues : array<f32, ${g}>;
       `, b = (_) => `
        ${_.registerUniform("reduceSize", "u32").declareVariables(p4, m)}
        ${y}
        fn DIV_CEIL(a : u32, b : u32) -> u32 {
          return ((a - 1u) / b + 1u);
         }
         ${_.mainStart(g)}

          let outputIndex = global_idx / ${g};
          let offset = outputIndex * uniforms.reduceSize;

          var bestValue = f32(${Zf[n]});
          let Length = uniforms.reduceSize;
          for (var k = local_idx; k < Length; k = k + ${g}) {
           let candidate = f32(${p4.getByOffset("offset + k")});
           bestValue = ${Kf[n]};
          }
          aBestValues[local_idx] = bestValue;
          workgroupBarrier();

         var reduceSize = min(Length, ${g}u);
         for (var currentSize = reduceSize / 2u; reduceSize > 1u;
             currentSize = reduceSize / 2u) {
           let interval = DIV_CEIL(reduceSize, 2u);
           if (local_idx < currentSize) {
            let candidate = aBestValues[local_idx + interval];
            bestValue = ${jf[n]};
            aBestValues[local_idx] = bestValue;
           }
           reduceSize = interval;
           workgroupBarrier();
         }

         if (local_idx == 0u) {
          ${m.setByOffset("outputIndex", `${n === "mean" ? `${m.type.storage}(bestValue / f32(uniforms.reduceSize))` : `${m.type.storage}(${Qf[n]})`}`)};
         }
        }`;
    return { name: t, shaderCache: { hint: `${e4};${g}`, inputDependencies: ["type"] }, getShaderSource: b, getRunData: () => ({ outputs: [{ dims: i, dataType: o }], dispatchGroup: { x: d }, programUniforms: [{ type: 12, data: c2 }] }) };
  }, it = (t, e4, r, n) => {
    let o = t.inputs.length === 1 ? r : go(t.inputs, r), i = o.axes;
    i.length === 0 && !o.noopWithEmptyAxes && (i = t.inputs[0].dims.map((y, b) => b));
    let s = k4.normalizeAxes(i, t.inputs[0].dims.length), u = s, d = t.inputs[0], c2 = th(u, t.inputs[0].dims.length);
    c2.length > 0 && (d = t.compute(Be(t.inputs[0], c2), { inputs: [0], outputs: [-1] })[0], u = Yf(u.length, d.dims.length));
    let [p4, m] = Xf(d.dims, u), g = p4;
    o.keepDims && (g = Jf(p4, s)), t.compute(rh(e4, o.cacheKey, [d], n, t.inputs[0].dataType, g, m), { inputs: [d] });
  }, Ks = (t, e4) => {
    it(t, "ReduceMeanShared", e4, "mean");
  }, js = (t, e4) => {
    it(t, "ReduceL1Shared", e4, "l1");
  }, Zs = (t, e4) => {
    it(t, "ReduceL2Shared", e4, "l2");
  }, Qs = (t, e4) => {
    it(t, "ReduceLogSumExpShared", e4, "logSumExp");
  }, Ys = (t, e4) => {
    it(t, "ReduceMaxShared", e4, "max");
  }, Xs = (t, e4) => {
    it(t, "ReduceMinShared", e4, "min");
  }, Js = (t, e4) => {
    it(t, "ReduceProdShared", e4, "prod");
  }, eu = (t, e4) => {
    it(t, "ReduceSumShared", e4, "sum");
  }, tu = (t, e4) => {
    it(t, "ReduceSumSquareShared", e4, "sumSquare");
  }, ru = (t, e4) => {
    it(t, "ReduceLogSumShared", e4, "logSum");
  };
});
var at;
var nh;
var Xr;
var go;
var st;
var oh;
var ih;
var ah;
var sh;
var uh;
var dh;
var lh;
var ch;
var ph;
var mh;
var ut;
var ou;
var iu;
var au;
var su;
var uu;
var du;
var lu;
var cu;
var pu;
var mu;
var Yr = V(() => {
  "use strict";
  J();
  re();
  Ce();
  oe();
  nu();
  at = (t) => {
    if (!t || t.length === 0 || t.length > 2) throw new Error("Reduce op requires 1 or 2 inputs.");
    if (t.length === 2 && t[1].dims.length !== 1) throw new Error("Invalid axes input dims.");
  }, nh = (t) => ["", "", `var value = ${t.getByIndices("input_indices")};`, ""], Xr = (t, e4, r, n, o, i, s = false, u = false) => {
    let d = [], c2 = r[0].dims, p4 = c2.length, m = k4.normalizeAxes(o, p4), g = !u && m.length === 0;
    c2.forEach((T, x) => {
      g || m.indexOf(x) >= 0 ? s && d.push(1) : d.push(T);
    });
    let y = d.length, b = k4.size(d);
    return { name: t, shaderCache: e4, getShaderSource: (T) => {
      let x = [], $ = O("_A", r[0].dataType, p4), S = U("output", i, y), I = n($, S, m), E = I[2];
      for (let A = 0, z = 0; A < p4; A++) g || m.indexOf(A) >= 0 ? (s && z++, E = `for(var j${A}: u32 = 0; j${A} < ${c2[A]}; j${A}++) {
                  ${I[2].includes("last_index") ? `let last_index = j${A};` : ""}
                  ${$.indicesSet("input_indices", A, `j${A}`)}
                  ${E}
                }`) : (x.push(`${$.indicesSet("input_indices", A, S.indicesGet("output_indices", z))};`), z++);
      return `

        ${T.registerUniform("output_size", "u32").declareVariables($, S)}

        ${T.mainStart()}
          ${T.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
          var input_indices: ${$.type.indices};
          let output_indices = ${S.offsetToIndices("global_idx")};

          ${x.join(`
`)}
          ${I[0]}       // init ops for reduce max/min
          ${I[1]}
          ${E}
          ${I[3]}
          ${I.length === 4 ? S.setByOffset("global_idx", "value") : I.slice(4).join(`
`)}
        }`;
    }, getRunData: () => ({ outputs: [{ dims: d, dataType: i }], dispatchGroup: { x: Math.ceil(b / 64) }, programUniforms: [{ type: 12, data: b }, ...W(c2, d)] }) };
  }, go = (t, e4) => {
    let r = [];
    return t[1].dims[0] > 0 && t[1].getBigInt64Array().forEach((n) => r.push(Number(n))), ee({ axes: r, keepDims: e4.keepDims, noopWithEmptyAxes: e4.noopWithEmptyAxes });
  }, st = (t, e4, r, n) => {
    let o = t.inputs, i = o.length === 1 ? r : go(o, r);
    t.compute(Xr(e4, { hint: i.cacheKey, inputDependencies: ["rank"] }, [o[0]], i.noopWithEmptyAxes && i.axes.length === 0 ? nh : n, i.axes, o[0].dataType, i.keepDims, i.noopWithEmptyAxes), { inputs: [0] });
  }, oh = (t, e4) => {
    at(t.inputs), st(t, "ReduceLogSum", e4, (n, o) => [`var value = ${o.type.storage}(0);`, "", `value += ${n.getByIndices("input_indices")};`, "value = log(value);"]);
  }, ih = (t, e4) => {
    at(t.inputs), st(t, "ReduceL1", e4, (n, o) => [`var value = ${o.type.storage}(0);`, "", `value += abs(${n.getByIndices("input_indices")});`, ""]);
  }, ah = (t, e4) => {
    at(t.inputs), st(t, "ReduceL2", e4, (n, o) => [`var t = ${o.type.value}(0); var value = ${o.type.value}(0);`, "", `t = ${n.getByIndices("input_indices")}; value += (t * t);`, "value = sqrt(value);"]);
  }, sh = (t, e4) => {
    at(t.inputs), st(t, "ReduceLogSumExp", e4, (n, o) => [`var value = ${o.type.storage}(0);`, "", `value += exp(${n.getByIndices("input_indices")});`, "value = log(value);"]);
  }, uh = (t, e4) => {
    at(t.inputs), st(t, "ReduceMax", e4, (n, o, i) => {
      let s = [];
      for (let u = 0; u < n.rank; u++) (i.indexOf(u) >= 0 || i.length === 0) && s.push(n.indicesSet("input_indices", u, 0));
      return [`${s.join(`
`)}`, `var value = ${n.getByIndices("input_indices")};`, `value = max(value, ${n.getByIndices("input_indices")});`, ""];
    });
  }, dh = (t, e4) => {
    at(t.inputs), st(t, "ReduceMean", e4, (n, o, i) => {
      let s = 1;
      for (let u = 0; u < n.rank; u++) (i.indexOf(u) >= 0 || i.length === 0) && (s *= t.inputs[0].dims[u]);
      return ["var sum = f32(0);", "", `sum += f32(${n.getByIndices("input_indices")});`, `let value = ${o.type.value}(sum / ${s});`];
    });
  }, lh = (t, e4) => {
    at(t.inputs), st(t, "ReduceMin", e4, (n, o, i) => {
      let s = [];
      for (let u = 0; u < n.rank; u++) (i.indexOf(u) >= 0 || i.length === 0) && s.push(`input_indices[${u}] = 0;`);
      return [`${s.join(`
`)}`, `var value = ${n.getByIndices("input_indices")};`, `value = min(value, ${n.getByIndices("input_indices")});`, ""];
    });
  }, ch = (t, e4) => {
    at(t.inputs), st(t, "ReduceProd", e4, (n, o) => [`var value = ${o.type.storage}(1);`, "", `value *= ${n.getByIndices("input_indices")};`, ""]);
  }, ph = (t, e4) => {
    at(t.inputs), st(t, "ReduceSum", e4, (n, o) => [`var value = ${o.type.storage}(0);`, "", `value += ${n.getByIndices("input_indices")};`, ""]);
  }, mh = (t, e4) => {
    at(t.inputs), st(t, "ReduceSumSquare", e4, (n, o) => [`var t = ${o.type.value}(0); var value = ${o.type.value}(0);`, "", `t = ${n.getByIndices("input_indices")}; value += t * t;`, ""]);
  }, ut = (t, e4, r) => {
    if (e4.length === 0) return r;
    let n = 1, o = 1;
    for (let i = 0; i < e4.length; i++) e4.indexOf(i) === -1 ? n *= t[i] : o *= t[i];
    return o < 32 && n > 1024;
  }, ou = (t, e4) => {
    ut(t.inputs[0].dims, e4.axes, e4.noopWithEmptyAxes) ? dh(t, e4) : Ks(t, e4);
  }, iu = (t, e4) => {
    ut(t.inputs[0].dims, e4.axes, e4.noopWithEmptyAxes) ? ih(t, e4) : js(t, e4);
  }, au = (t, e4) => {
    ut(t.inputs[0].dims, e4.axes, e4.noopWithEmptyAxes) ? ah(t, e4) : Zs(t, e4);
  }, su = (t, e4) => {
    ut(t.inputs[0].dims, e4.axes, e4.noopWithEmptyAxes) ? sh(t, e4) : Qs(t, e4);
  }, uu = (t, e4) => {
    ut(t.inputs[0].dims, e4.axes, e4.noopWithEmptyAxes) ? uh(t, e4) : Ys(t, e4);
  }, du = (t, e4) => {
    ut(t.inputs[0].dims, e4.axes, e4.noopWithEmptyAxes) ? lh(t, e4) : Xs(t, e4);
  }, lu = (t, e4) => {
    ut(t.inputs[0].dims, e4.axes, e4.noopWithEmptyAxes) ? ch(t, e4) : Js(t, e4);
  }, cu = (t, e4) => {
    ut(t.inputs[0].dims, e4.axes, e4.noopWithEmptyAxes) ? ph(t, e4) : eu(t, e4);
  }, pu = (t, e4) => {
    ut(t.inputs[0].dims, e4.axes, e4.noopWithEmptyAxes) ? mh(t, e4) : tu(t, e4);
  }, mu = (t, e4) => {
    ut(t.inputs[0].dims, e4.axes, e4.noopWithEmptyAxes) ? oh(t, e4) : ru(t, e4);
  };
});
var fu;
var hu;
var gu;
var bo;
var bu = V(() => {
  "use strict";
  J();
  Ce();
  Yr();
  fu = (t) => {
    if (!t || t.length === 0 || t.length > 2) throw new Error("ArgMinMaxOp op requires 1 or 2 inputs.");
    if (t[0].dataType !== 1) throw new Error("Invalid input type.");
  }, hu = (t, e4) => {
    fu(t.inputs);
    let r = (n, o, i) => {
      let s = [];
      for (let u = 0; u < n.rank; u++) (i.indexOf(u) >= 0 || i.length === 0) && s.push(`input_indices[${u}] = 0;`);
      return [`${s.join(`
`)}`, `var value = ${n.getByIndices("input_indices")};
var best_index : i32 = 0;`, `if (${n.getByIndices("input_indices")} ${e4.selectLastIndex > 0 ? "<=" : "<"} value) {
         value = ${n.getByIndices("input_indices")};
         best_index = i32(last_index);
       }`, "", o.setByOffset("global_idx", "best_index")];
    };
    t.compute(Xr("ArgMin", { hint: e4.cacheKey, inputDependencies: ["rank"] }, [t.inputs[0]], r, [e4.axis], 7, e4.keepDims), { inputs: [0] });
  }, gu = (t, e4) => {
    fu(t.inputs);
    let r = (n, o, i) => {
      let s = [];
      for (let u = 0; u < n.rank; u++) (i.indexOf(u) >= 0 || i.length === 0) && s.push(`input_indices[${u}] = 0;`);
      return [`${s.join(`
`)}`, `var value = ${n.getByIndices("input_indices")};
var best_index : i32 = 0;`, `if (${n.getByIndices("input_indices")} ${e4.selectLastIndex > 0 ? ">=" : ">"} value) {
         value = ${n.getByIndices("input_indices")};
         best_index = i32(last_index);
       }`, "", o.setByOffset("global_idx", "best_index")];
    };
    t.compute(Xr("argMax", { hint: e4.cacheKey, inputDependencies: ["rank"] }, [t.inputs[0]], r, [e4.axis], 7, e4.keepDims), { inputs: [0] });
  }, bo = (t) => ee(t);
});
var fh;
var yo;
var hh;
var gh;
var bh;
var Gt;
var yh;
var yu;
var Jr = V(() => {
  "use strict";
  J();
  re();
  jr();
  oe();
  fh = (t, e4) => {
    let r = t[0], n = t[1], o = t[2], i = t[3], s = t[4], u = t[5];
    if (s && u) throw new Error("Attention cannot have both past and attention_bias");
    if (r.dims.length !== 3) throw new Error('Input "input" must have 3 dimensions');
    let d = r.dims[0], c2 = r.dims[1], p4 = r.dims[2];
    if (o.dims.length !== 1) throw new Error('Input "bias" is expected to have 1 dimensions');
    if (n.dims.length !== 2) throw new Error('Input "weights" is expected to have 2 dimensions');
    if (n.dims[0] !== p4) throw new Error("Input 1 dimension 0 should have same length as dimension 2 of input 0");
    if (o.dims[0] !== n.dims[1]) throw new Error('Input "bias" dimension 0 should have same length as dimension 1 of input "weights"');
    let m = o.dims[0] / 3, g = m, y = g;
    if (e4.qkvHiddenSizes.length > 0) {
      if (e4.qkvHiddenSizes.length !== 3) throw new Error("qkv_hidden_sizes attribute should have 3 elements");
      for (let S of e4.qkvHiddenSizes) if (S % e4.numHeads !== 0) throw new Error("qkv_hidden_sizes should be divisible by num_heads");
      m = e4.qkvHiddenSizes[0], g = e4.qkvHiddenSizes[1], y = e4.qkvHiddenSizes[2];
    }
    let b = c2;
    if (m !== g) throw new Error("qkv_hidden_sizes first element should be same as the second");
    if (o.dims[0] !== m + g + y) throw new Error('Input "bias" dimension 0 should have same length as sum of Q/K/V hidden sizes');
    let _ = 0;
    if (s) {
      if (g !== y) throw new Error('Input "past" expect k_hidden_size == v_hidden_size');
      if (s.dims.length !== 5) throw new Error('Input "past" must have 5 dimensions');
      if (s.dims[0] !== 2) throw new Error('Input "past" first dimension must be 2');
      if (s.dims[1] !== d) throw new Error('Input "past" second dimension must be batch_size');
      if (s.dims[2] !== e4.numHeads) throw new Error('Input "past" third dimension must be num_heads');
      if (s.dims[4] !== g / e4.numHeads) throw new Error('Input "past" fifth dimension must be k_hidden_size / num_heads');
      e4.pastPresentShareBuffer || (_ = s.dims[3]);
    }
    let T = b + _, x = -1, $ = 0;
    if (i) throw new Error("Mask not supported");
    if (s) throw new Error("past is not supported");
    if (u) {
      if (u.dims.length !== 4) throw new Error('Input "attention_bias" must have 4 dimensions');
      if (u.dims[0] !== d || u.dims[1] !== e4.numHeads || u.dims[2] !== c2 || u.dims[3] !== T) throw new Error('Expect "attention_bias" shape (batch_size, num_heads, sequence_length, total_sequence_length)');
    }
    return { batchSize: d, sequenceLength: c2, pastSequenceLength: _, kvSequenceLength: b, totalSequenceLength: T, maxSequenceLength: x, inputHiddenSize: p4, hiddenSize: m, vHiddenSize: y, headSize: Math.floor(m / e4.numHeads), vHeadSize: Math.floor(y / e4.numHeads), numHeads: e4.numHeads, isUnidirectional: false, pastPresentShareBuffer: false, maskFilterValue: e4.maskFilterValue, maskType: $, scale: e4.scale, broadcastResPosBias: false, passPastInKv: false, qkvFormat: 1 };
  }, yo = (t, e4, r) => e4 && t ? `
      let total_sequence_length_input = u32(${e4.getByOffset("0")});
      let present_sequence_length = max(total_sequence_length_input, uniforms.past_sequence_length);
      let is_subsequent_prompt: bool = sequence_length > 1 && sequence_length != total_sequence_length_input;
      let is_first_prompt: bool = is_subsequent_prompt == false && sequence_length == total_sequence_length_input;
      total_sequence_length = u32(${t?.getByOffset("batchIdx")}) + 1;
      var past_sequence_length: u32 = 0;
      if (is_first_prompt == false) {
        past_sequence_length = total_sequence_length - sequence_length;
      }
       ` : `
    ${r ? "let past_sequence_length = uniforms.past_sequence_length" : ""};
    let present_sequence_length = total_sequence_length;
    `, hh = (t, e4, r, n, o, i, s, u) => {
    let d = fe(s ? 1 : i), c2 = 64, p4 = i / d;
    p4 < c2 && (c2 = 32);
    let m = Math.ceil(i / d / c2), g = [{ type: 12, data: e4 }, { type: 12, data: r }, { type: 12, data: n }, { type: 12, data: o }, { type: 12, data: p4 }, { type: 12, data: m }], y = we(t.dataType, d), b = ze(1, d), _ = ["type"];
    s && _.push("type"), u && _.push("type");
    let T = (x) => {
      let $ = U("x", t.dataType, t.dims, d), S = [$], I = s ? O("seq_lens", s.dataType, s.dims) : void 0;
      I && S.push(I);
      let E = u ? O("total_sequence_length_input", u.dataType, u.dims) : void 0;
      E && S.push(E);
      let A = ze(t.dataType), z = [{ name: "batch_size", type: "u32" }, { name: "num_heads", type: "u32" }, { name: "past_sequence_length", type: "u32" }, { name: "sequence_length", type: "u32" }, { name: "total_sequence_length", type: "u32" }, { name: "elements_per_thread", type: "u32" }];
      return `
  var<workgroup> thread_max: array<f32, ${c2}>;
  var<workgroup> thread_sum: array<f32, ${c2}>;
  ${x.registerUniforms(z).declareVariables(...S)}
  ${x.mainStart([c2, 1, 1])}
    let batchIdx = workgroup_id.z / uniforms.num_heads;
    let headIdx = workgroup_id.z % uniforms.num_heads;
    let sequence_length = uniforms.sequence_length;
    var total_sequence_length = uniforms.total_sequence_length;
    ${yo(I, E, false)}
    let local_offset = local_idx * uniforms.elements_per_thread;
    let offset = (global_idx / ${c2}) * uniforms.total_sequence_length + local_offset;
    let seq_causal_length = ${s ? "u32(past_sequence_length + workgroup_id.y + 1)" : "total_sequence_length"};
    var thread_max_vector = ${b}(-3.4028234663852886e+38f);
    for (var i: u32 = 0; i < uniforms.elements_per_thread && i + local_offset < seq_causal_length; i++) {
      thread_max_vector = max(${b}(x[offset + i]), thread_max_vector);
    }
    thread_max[local_idx] = ${(() => {
        switch (d) {
          case 1:
            return "thread_max_vector";
          case 2:
            return "max(thread_max_vector.x, thread_max_vector.y)";
          case 4:
            return "max(max(thread_max_vector.x, thread_max_vector.y), max(thread_max_vector.z, thread_max_vector.w))";
          default:
            throw new Error(`Unsupported components: ${d}`);
        }
      })()};
    workgroupBarrier();

    var max_value =  f32(-3.4028234663852886e+38f);
    for (var i = 0u; i < ${c2}; i++) {
      max_value = max(thread_max[i], max_value);
    }

    var sum_vector = ${b}(0);
    for (var i: u32 = 0; i < uniforms.elements_per_thread && i + local_offset < seq_causal_length; i++) {
      sum_vector += exp(${b}(x[offset + i]) - max_value);
    }
    thread_sum[local_idx] = ${(() => {
        switch (d) {
          case 1:
            return "sum_vector";
          case 2:
            return "sum_vector.x + sum_vector.y";
          case 4:
            return "sum_vector.x + sum_vector.y + sum_vector.z + sum_vector.w";
          default:
            throw new Error(`Unsupported components: ${d}`);
        }
      })()};
    workgroupBarrier();

    var sum: f32 = 0;
    for (var i = 0u; i < ${c2}; i++) {
      sum += thread_sum[i];
    }

    if (sum == 0) {
      for (var i: u32 = 0; i < uniforms.elements_per_thread && i + local_offset < seq_causal_length; i++) {
        x[offset + i] = ${$.type.value}(${A}(1.0) / ${A}(seq_causal_length));
      }
    } else {
      for (var i: u32 = 0; i < uniforms.elements_per_thread && i + local_offset < seq_causal_length; i++) {
        var f32input = ${b}(x[offset + i]);
        x[offset + i] = ${$.type.value}(exp(f32input - max_value) / sum);
      }
    }
      ${s ? `
        for (var total_seq_id: u32 = seq_causal_length; total_seq_id + local_offset < uniforms.total_sequence_length; total_seq_id++) {
          x[offset + total_seq_id] = ${$.type.value}(${A}(0));
        }` : ""};
  }`;
    };
    return { name: "AttentionProbsSoftmax", shaderCache: { hint: `${c2};${y};${d}`, inputDependencies: _ }, getShaderSource: T, getRunData: () => ({ outputs: [], dispatchGroup: { x: 1, y: o, z: e4 * r }, programUniforms: g }) };
  }, gh = (t, e4, r, n, o, i, s, u, d) => {
    let c2 = s + i.kvSequenceLength, p4 = [i.batchSize, i.numHeads, i.sequenceLength, c2], m = t > 1 && n, g = i.kvNumHeads ? i.kvNumHeads : i.numHeads, y = m ? [i.batchSize, g, c2, i.headSize] : void 0, b = i.nReps ? i.nReps : 1, _ = i.scale === 0 ? 1 / Math.sqrt(i.headSize) : i.scale, T = fe(i.headSize), x = i.headSize / T, $ = 12, S = { x: Math.ceil(c2 / $), y: Math.ceil(i.sequenceLength / $), z: i.batchSize * i.numHeads }, I = [{ type: 12, data: i.sequenceLength }, { type: 12, data: x }, { type: 12, data: c2 }, { type: 12, data: i.numHeads }, { type: 12, data: i.headSize }, { type: 1, data: _ }, { type: 12, data: s }, { type: 12, data: i.kvSequenceLength }, { type: 12, data: b }], E = m && n && k4.size(n.dims) > 0, A = ["type", "type"];
    E && A.push("type"), o && A.push("type"), u && A.push("type"), d && A.push("type");
    let z = [{ dims: p4, dataType: e4.dataType, gpuDataType: 0 }];
    m && z.push({ dims: y, dataType: e4.dataType, gpuDataType: 0 });
    let v = (R) => {
      let N = O("q", e4.dataType, e4.dims, T), F = O("key", r.dataType, r.dims, T), q = [N, F];
      if (E) {
        let te = O("past_key", n.dataType, n.dims, T);
        q.push(te);
      }
      o && q.push(O("attention_bias", o.dataType, o.dims));
      let X = u ? O("seq_lens", u.dataType, u.dims) : void 0;
      X && q.push(X);
      let B = d ? O("total_sequence_length_input", d.dataType, d.dims) : void 0;
      B && q.push(B);
      let L = U("output", e4.dataType, p4), Q = [L];
      m && Q.push(U("present_key", e4.dataType, y, T));
      let Y = ze(1, T), Z = [{ name: "M", type: "u32" }, { name: "K", type: "u32" }, { name: "N", type: "u32" }, { name: "num_heads", type: "u32" }, { name: "head_size", type: "u32" }, { name: "alpha", type: "f32" }, { name: "past_sequence_length", type: "u32" }, { name: "kv_sequence_length", type: "u32" }, { name: "n_reps", type: "u32" }];
      return `
  const TILE_SIZE = ${$}u;

  var<workgroup> tileQ: array<${N.type.storage}, ${$ * $}>;
  var<workgroup> tileK: array<${N.type.storage}, ${$ * $}>;
  ${R.registerUniforms(Z).declareVariables(...q, ...Q)}
  ${R.mainStart([$, $, 1])}
    // x holds the N and y holds the M
    let headIdx = workgroup_id.z % uniforms.num_heads;
    let kvHeadIdx = ${b === 1 ? "headIdx" : "headIdx / uniforms.n_reps"};
    let kv_num_heads = ${b === 1 ? "uniforms.num_heads" : "uniforms.num_heads / uniforms.n_reps"};
    let batchIdx = workgroup_id.z / uniforms.num_heads;
    let m = workgroup_id.y * TILE_SIZE;
    let n = workgroup_id.x * TILE_SIZE;
    let sequence_length = uniforms.M;
    var total_sequence_length = uniforms.N;
    ${yo(X, B, true)}
    let absKvHeadIdx = batchIdx * kv_num_heads + kvHeadIdx;
    let qOffset = workgroup_id.z * uniforms.M * uniforms.K + m * uniforms.K;
    ${E && m ? "let pastKeyOffset = absKvHeadIdx * uniforms.past_sequence_length * uniforms.K;" : ""};
    let kOffset = absKvHeadIdx * uniforms.kv_sequence_length * uniforms.K;
    ${m ? "let presentKeyOffset = absKvHeadIdx * uniforms.N * uniforms.K;" : ""}
    var value = ${Y}(0);
    for (var w: u32 = 0u; w < uniforms.K; w += TILE_SIZE) {
      if (global_id.y < uniforms.M && w + local_id.x < uniforms.K) {
        tileQ[TILE_SIZE * local_id.y + local_id.x] = q[qOffset + local_id.y * uniforms.K + w + local_id.x];
      }
      if (n + local_id.y < uniforms.N && w + local_id.x < uniforms.K) {
        var idx = TILE_SIZE * local_id.y + local_id.x;
      ${E && m ? `
              if (n + local_id.y < past_sequence_length) {
                tileK[idx] = past_key[pastKeyOffset + (n + local_id.y) * uniforms.K + w + local_id.x];
              } else if (n + local_id.y - past_sequence_length < uniforms.kv_sequence_length) {
                tileK[idx] = key[kOffset + (n + local_id.y - past_sequence_length) * uniforms.K + w + local_id.x];
              }` : `
          if (n + local_id.y < uniforms.kv_sequence_length) {
            tileK[idx] = key[kOffset + (n + local_id.y) * uniforms.K + w + local_id.x];
          }`}
      ${m ? `if (n + local_id.y < present_sequence_length) {
        present_key[presentKeyOffset + (n + local_id.y) * uniforms.K + w + local_id.x] = tileK[idx];
      }` : ""}
      }
      workgroupBarrier();

      for (var k: u32 = 0u; k < TILE_SIZE && w+k < uniforms.K; k++) {
          value += ${Y}(tileQ[TILE_SIZE * local_id.y + k] * tileK[TILE_SIZE * local_id.x + k]);
      }

      workgroupBarrier();
    }

    if (global_id.y < uniforms.M && global_id.x < total_sequence_length) {
      let headOffset = workgroup_id.z * uniforms.M * uniforms.N;
      let outputIdx = headOffset + global_id.y * uniforms.N + global_id.x;
      var sum: f32 = ${(() => {
        switch (T) {
          case 1:
            return "value";
          case 2:
            return "value.x + value.y";
          case 4:
            return "value.x + value.y + value.z + value.w";
          default:
            throw new Error(`Unsupported components: ${T}`);
        }
      })()};
        output[outputIdx] = ${L.type.value} (sum * uniforms.alpha) + ${o ? "attention_bias[outputIdx]" : "0.0"};
    }
  }`;
    };
    return { name: "AttentionProbs", shaderCache: { hint: `${T};${o !== void 0};${n !== void 0};${t}`, inputDependencies: A }, getRunData: () => ({ outputs: z, dispatchGroup: S, programUniforms: I }), getShaderSource: v };
  }, bh = (t, e4, r, n, o, i, s = void 0, u = void 0) => {
    let d = i + o.kvSequenceLength, c2 = o.nReps ? o.nReps : 1, p4 = o.vHiddenSize * c2, m = t > 1 && n, g = o.kvNumHeads ? o.kvNumHeads : o.numHeads, y = m ? [o.batchSize, g, d, o.headSize] : void 0, b = [o.batchSize, o.sequenceLength, p4], _ = 12, T = { x: Math.ceil(o.vHeadSize / _), y: Math.ceil(o.sequenceLength / _), z: o.batchSize * o.numHeads }, x = [{ type: 12, data: o.sequenceLength }, { type: 12, data: d }, { type: 12, data: o.vHeadSize }, { type: 12, data: o.numHeads }, { type: 12, data: o.headSize }, { type: 12, data: p4 }, { type: 12, data: i }, { type: 12, data: o.kvSequenceLength }, { type: 12, data: c2 }], $ = m && n && k4.size(n.dims) > 0, S = ["type", "type"];
    $ && S.push("type"), s && S.push("type"), u && S.push("type");
    let I = [{ dims: b, dataType: e4.dataType, gpuDataType: 0 }];
    m && I.push({ dims: y, dataType: e4.dataType, gpuDataType: 0 });
    let E = (A) => {
      let z = O("probs", e4.dataType, e4.dims), v = O("v", r.dataType, r.dims), R = [z, v];
      $ && R.push(O("past_value", n.dataType, n.dims));
      let N = s ? O("seq_lens", s.dataType, s.dims) : void 0;
      s && R.push(N);
      let F = u ? O("total_sequence_length_input", u.dataType, u.dims) : void 0;
      u && R.push(F);
      let X = [U("output", e4.dataType, b)];
      m && X.push(U("present_value", e4.dataType, y));
      let B = [{ name: "M", type: "u32" }, { name: "K", type: "u32" }, { name: "N", type: "u32" }, { name: "num_heads", type: "u32" }, { name: "head_size", type: "u32" }, { name: "v_hidden_size", type: "u32" }, { name: "past_sequence_length", type: "u32" }, { name: "kv_sequence_length", type: "u32" }, { name: "n_reps", type: "u32" }];
      return `
  const TILE_SIZE = ${_}u;
  var<workgroup> tileQ: array<${z.type.value}, ${_ * _}>;
  var<workgroup> tileV: array<${z.type.value}, ${_ * _}>;
  ${A.registerUniforms(B).declareVariables(...R, ...X)}
  ${A.mainStart([_, _, 1])}
   let headIdx = workgroup_id.z % uniforms.num_heads;
   let batchIdx = workgroup_id.z / uniforms.num_heads;
   let kvHeadIdx = ${c2 === 1 ? "headIdx" : "headIdx / uniforms.n_reps"};
   let kv_num_heads = ${c2 === 1 ? "uniforms.num_heads" : "uniforms.num_heads / uniforms.n_reps"};
   let m = global_id.y;
   let n = global_id.x;
   let sequence_length = uniforms.M;
   var total_sequence_length = uniforms.K;
   ${yo(N, F, true)}
   let offsetA = workgroup_id.z * uniforms.M * uniforms.K + m * uniforms.K;
   let absKvHeadIdx = batchIdx * kv_num_heads + kvHeadIdx; // kvHeadIdx is relative to the batch
   ${$ && m ? "let pastValueOffset = absKvHeadIdx * uniforms.N * uniforms.past_sequence_length + n;" : ""};
   let vOffset = absKvHeadIdx * uniforms.N * uniforms.kv_sequence_length + n;
   ${m ? "let presentValueOffset = absKvHeadIdx * uniforms.N * uniforms.K + n;" : ""}
   var value = ${z.type.storage}(0);
   for (var w: u32 = 0u; w < uniforms.K; w += TILE_SIZE) {
      if (m < uniforms.M && w + local_id.x < uniforms.K) {
        tileQ[TILE_SIZE * local_id.y + local_id.x] = probs[offsetA + w + local_id.x];
      }
      if (n < uniforms.N && w + local_id.y < uniforms.K) {
        var idx = TILE_SIZE * local_id.y + local_id.x;
        ${$ && m ? `
        if (w + local_id.y < past_sequence_length) {
          tileV[idx] = past_value[pastValueOffset + (w + local_id.y) * uniforms.N];
        } else if (w + local_id.y - past_sequence_length < uniforms.kv_sequence_length) {
          tileV[idx] = v[vOffset + (w + local_id.y - past_sequence_length) * uniforms.N];
        }
      ` : `
            if (w + local_id.y < uniforms.kv_sequence_length) {
              tileV[idx] = v[vOffset + (w + local_id.y) * uniforms.N];
            }`}
        ${m ? `
            if (w + local_id.y < present_sequence_length) {
          present_value[presentValueOffset + (w + local_id.y) * uniforms.N] = tileV[idx];
        }` : ""}
      }
     workgroupBarrier();
     for (var k: u32 = 0u; k < TILE_SIZE && w+k < total_sequence_length; k++) {
       value += tileQ[TILE_SIZE * local_id.y + k] * tileV[TILE_SIZE * k + local_id.x];
     }
     workgroupBarrier();
   }

   // we need to transpose output from BNSH_v to BSND_v
   if (m < uniforms.M && n < uniforms.N) {
     let outputIdx = batchIdx * uniforms.M * uniforms.v_hidden_size + m * uniforms.v_hidden_size
       + headIdx * uniforms.N + n;
     output[outputIdx] = value;
   }
  }`;
    };
    return { name: "AttentionScore", shaderCache: { hint: `${n !== void 0};${t}`, inputDependencies: S }, getRunData: () => ({ outputs: I, dispatchGroup: T, programUniforms: x }), getShaderSource: E };
  }, Gt = (t, e4, r, n, o, i, s, u, d, c2, p4 = void 0, m = void 0) => {
    let g = Math.min(t.outputCount, 1 + (s ? 1 : 0) + (u ? 1 : 0)), y = g > 1 ? s : void 0, b = g > 1 ? u : void 0, _ = g > 1 ? c2.pastSequenceLength : 0, T = _ + c2.kvSequenceLength, x = d && k4.size(d.dims) > 0 ? d : void 0, $ = [e4, r];
    y && k4.size(y.dims) > 0 && $.push(y), x && $.push(x), p4 && $.push(p4), m && $.push(m);
    let S = t.compute(gh(g, e4, r, y, x, c2, _, p4, m), { inputs: $, outputs: g > 1 ? [-1, 1] : [-1] })[0];
    t.compute(hh(S, c2.batchSize, c2.numHeads, _, c2.sequenceLength, T, p4, m), { inputs: p4 && m ? [S, p4, m] : [S], outputs: [] });
    let I = [S, n];
    b && k4.size(b.dims) > 0 && I.push(b), p4 && I.push(p4), m && I.push(m), t.compute(bh(g, S, n, b, c2, _, p4, m), { inputs: I, outputs: g > 1 ? [0, 2] : [0] });
  }, yh = (t, e4) => {
    let r = [e4.batchSize, e4.numHeads, e4.sequenceLength, e4.headSize], n = e4.sequenceLength, o = e4.inputHiddenSize, i = e4.headSize, s = 12, u = { x: Math.ceil(e4.headSize / s), y: Math.ceil(e4.sequenceLength / s), z: e4.batchSize * e4.numHeads }, d = [t.inputs[0], t.inputs[1], t.inputs[2]], c2 = [{ type: 12, data: n }, { type: 12, data: o }, { type: 12, data: i }, { type: 12, data: e4.numHeads }, { type: 12, data: e4.headSize }, { type: 12, data: e4.hiddenSize }, { type: 12, data: e4.hiddenSize + e4.hiddenSize + e4.vHiddenSize }], p4 = (m) => {
      let g = U("output_q", d[0].dataType, r), y = U("output_k", d[0].dataType, r), b = U("output_v", d[0].dataType, r), _ = O("input", d[0].dataType, d[0].dims), T = O("weight", d[1].dataType, d[1].dims), x = O("bias", d[2].dataType, d[2].dims), $ = _.type.storage, S = [{ name: "M", type: "u32" }, { name: "K", type: "u32" }, { name: "N", type: "u32" }, { name: "num_heads", type: "u32" }, { name: "head_size", type: "u32" }, { name: "hidden_size", type: "u32" }, { name: "ldb", type: "u32" }];
      return `
  const TILE_SIZE = ${s}u;
  var<workgroup> tileInput: array<${$}, ${s * s}>;
  var<workgroup> tileWeightQ: array<${$}, ${s * s}>;
  var<workgroup> tileWeightK: array<${$}, ${s * s}>;
  var<workgroup> tileWeightV: array<${$}, ${s * s}>;
  ${m.registerUniforms(S).declareVariables(_, T, x, g, y, b)}
  ${m.mainStart([s, s, 1])}
    let batchIndex = workgroup_id.z / uniforms.num_heads;
    let headNumber = workgroup_id.z % uniforms.num_heads;
    let m = global_id.y;
    let n = global_id.x;

    let inputOffset = batchIndex * (uniforms.M * uniforms.K) + m * uniforms.K;
    let biasOffsetQ = headNumber * uniforms.head_size;
    let biasOffsetK = uniforms.hidden_size + biasOffsetQ;
    let biasOffsetV = uniforms.hidden_size + biasOffsetK;

    var valueQ = ${$}(0);
    var valueK = ${$}(0);
    var valueV = ${$}(0);
    for (var w: u32 = 0u; w < uniforms.K; w += TILE_SIZE) {
      if (m < uniforms.M && w + local_id.x < uniforms.K) {
        tileInput[TILE_SIZE * local_id.y + local_id.x] = input[inputOffset + w + local_id.x];
      }
      if (n < uniforms.N && w + local_id.y < uniforms.K) {
        let offset = n + (w + local_id.y) * uniforms.ldb;
        tileWeightQ[TILE_SIZE * local_id.y + local_id.x] = weight[biasOffsetQ + offset];
        tileWeightK[TILE_SIZE * local_id.y + local_id.x] = weight[biasOffsetK + offset];
        tileWeightV[TILE_SIZE * local_id.y + local_id.x] = weight[biasOffsetV + offset];
      }
      workgroupBarrier();
      for (var k: u32 = 0u; k<TILE_SIZE && w+k < uniforms.K; k++) {
        let inputTileOffset = TILE_SIZE * local_id.y + k;
        let weightTileOffset = TILE_SIZE * k + local_id.x;
        valueQ += tileInput[inputTileOffset] * tileWeightQ[weightTileOffset];
        valueK += tileInput[inputTileOffset] * tileWeightK[weightTileOffset];
        valueV += tileInput[inputTileOffset] * tileWeightV[weightTileOffset];
      }

      workgroupBarrier();
    }

    let headOffset = (m * uniforms.N + n) % uniforms.head_size;
    valueQ += bias[headOffset + biasOffsetQ];
    valueK += bias[headOffset + biasOffsetK];
    valueV += bias[headOffset + biasOffsetV];

    let offset = workgroup_id.z * uniforms.M * uniforms.N;
    if (m < uniforms.M && n < uniforms.N) {
      let outputIdx = offset + m * uniforms.N + n;
      output_q[outputIdx] = valueQ;
      output_k[outputIdx] = valueK;
      output_v[outputIdx] = valueV;
    }
  }`;
    };
    return t.compute({ name: "AttentionPrepare", shaderCache: { inputDependencies: ["type", "type", "type"] }, getRunData: () => ({ outputs: [{ dims: r, dataType: t.inputs[0].dataType, gpuDataType: 0 }, { dims: r, dataType: t.inputs[0].dataType, gpuDataType: 0 }, { dims: r, dataType: t.inputs[0].dataType, gpuDataType: 0 }], dispatchGroup: u, programUniforms: c2 }), getShaderSource: p4 }, { inputs: d, outputs: [-1, -1, -1] });
  }, yu = (t, e4) => {
    let r = fh(t.inputs, e4), [n, o, i] = yh(t, r);
    return Gt(t, n, o, i, t.inputs[4], void 0, void 0, void 0, t.inputs[5], r);
  };
});
var _h;
var wh;
var vh;
var _u;
var wu = V(() => {
  "use strict";
  Le();
  J();
  re();
  Ce();
  oe();
  _h = (t, e4) => {
    if (!t || t.length !== 5) throw new Error("BatchNormalization requires 5 inputs");
    let r = (n, o, i) => {
      let s = o.length;
      if (s !== n.length) throw new Error(`${i}: num dimensions != ${s}`);
      o.forEach((u, d) => {
        if (u !== n[d]) throw new Error(`${i}: dim[${d}] do not match`);
      });
    };
    if (t[0].dims.length > 1) {
      let n = e4.format === "NHWC" ? e4.spatial ? t[0].dims.slice(-1) : t[0].dims.slice(-1).concat(t[0].dims.slice(1, t[0].dims.length - 1)) : t[0].dims.slice(1, e4.spatial ? 2 : void 0);
      r(t[1].dims, n, "Invalid input scale"), r(t[2].dims, n, "Invalid input B"), r(t[3].dims, n, "Invalid input mean"), r(t[4].dims, n, "Invalid input var");
    } else r(t[1].dims, [1], "Invalid input scale"), r(t[2].dims, [1], "Invalid input B"), r(t[3].dims, [1], "Invalid input mean"), r(t[4].dims, [1], "Invalid input var");
  }, wh = (t, e4) => {
    let { epsilon: r, spatial: n, format: o } = e4, i = t[0].dims, s = n ? fe(i[i.length - 1]) : 1, u = o === "NHWC" && i.length > 1 ? s : 1, d = k4.size(i) / s, c2 = n, p4 = c2 ? i.length : i, m = O("x", t[0].dataType, t[0].dims, s), g = O("scale", t[1].dataType, t[1].dims, u), y = O("bias", t[2].dataType, t[2].dims, u), b = O("inputMean", t[3].dataType, t[3].dims, u), _ = O("inputVar", t[4].dataType, t[4].dims, u), T = U("y", t[0].dataType, p4, s), x = () => {
      let S = "";
      if (n) S = `let cOffset = ${i.length === 1 ? "0u" : o === "NHWC" ? `outputIndices[${i.length - 1}] / ${s}` : "outputIndices[1]"};`;
      else if (o === "NCHW") S = `
            ${T.indicesSet("outputIndices", "0", "0")}
            let cOffset = ${T.indicesToOffset("outputIndices")};`;
      else {
        S = `var cIndices = ${g.type.indices}(0);
                       cIndices[0] = outputIndices[${i.length - 1}];`;
        for (let I = 1; I < g.rank; I++) S += `cIndices[${I}] = outputIndices[${I}];`;
        S += `let cOffset = ${g.indicesToOffset("cIndices")};`;
      }
      return S;
    }, $ = (S) => `
  const epsilon = ${r};
  ${S.registerUniform("outputSize", "u32").declareVariables(m, g, y, b, _, T)}
  ${S.mainStart()}
  ${S.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
    var outputIndices = ${T.offsetToIndices(`global_idx * ${s}`)};
    ${x()}
    let scale = ${g.getByOffset("cOffset")};
    let bias = ${y.getByOffset("cOffset")};
    let inputMean = ${b.getByOffset("cOffset")};
    let inputVar = ${_.getByOffset("cOffset")};
    let x = ${m.getByOffset("global_idx")};
    let value = (x - inputMean) * inverseSqrt(inputVar + epsilon) * scale + bias;
    ${T.setByOffset("global_idx", "value")}
  }`;
    return { name: "BatchNormalization", shaderCache: { hint: `${e4.epsilon}_${e4.format}_${n}_${s}`, inputDependencies: c2 ? ["rank", "type", "type", "type", "type"] : void 0 }, getShaderSource: $, getRunData: () => ({ outputs: [{ dims: t[0].dims, dataType: t[0].dataType }], dispatchGroup: { x: Math.ceil(d / 64) }, programUniforms: c2 ? [{ type: 12, data: d }, ...W(i)] : [{ type: 12, data: d }] }) };
  }, vh = (t) => ee(t), _u = (t, e4) => {
    let { inputs: r, outputCount: n } = t, o = vh({ ...e4, outputCount: n });
    if (_e.webgpu.validateInputContent && _h(r, o), e4.trainingMode) throw new Error("BatchNormalization trainingMode is not supported yet.");
    t.compute(wh(r, o));
  };
});
var $h;
var xh;
var vu;
var $u = V(() => {
  "use strict";
  re();
  oe();
  $h = (t) => {
    if (t[0].dims.length !== 3) throw new Error("input should have 3 dimensions");
    if (![320, 640, 1280].includes(t[0].dims[2])) throw new Error("number of channels should be 320, 640 or 1280");
    if (t[1].dims.length !== 1) throw new Error("bias is expected to have 1 dimensions");
    if (t[0].dims[2] !== t[1].dims[0]) throw new Error("last dimension of input and bias are not the same");
  }, xh = (t) => {
    let e4 = t[0].dims, r = t[0].dims[2], n = k4.size(e4) / 4, o = t[0].dataType, i = O("input", o, e4, 4), s = O("bias", o, [r], 4), u = O("residual", o, e4, 4), d = U("output", o, e4, 4);
    return { name: "BiasAdd", getRunData: () => ({ outputs: [{ dims: e4, dataType: t[0].dataType }], dispatchGroup: { x: Math.ceil(n / 64) } }), getShaderSource: (p4) => `
  const channels = ${r}u / 4;
  ${p4.declareVariables(i, s, u, d)}

  ${p4.mainStart()}
    ${p4.guardAgainstOutOfBoundsWorkgroupSizes(n)}
    let value = ${i.getByOffset("global_idx")}
      + ${s.getByOffset("global_idx % channels")} + ${u.getByOffset("global_idx")};
    ${d.setByOffset("global_idx", "value")}
  }` };
  }, vu = (t) => {
    $h(t.inputs), t.compute(xh(t.inputs));
  };
});
var Sh;
var ge;
var xu;
var Su;
var Tu;
var Iu;
var Cu;
var Au;
var Eu;
var ku;
var Pu;
var Th;
var Ou;
var zu;
var Bu;
var Du;
var or;
var Mu;
var en;
var Ru;
var Uu;
var Nu;
var Vu;
var Lu;
var Wu;
var Gu;
var Hu;
var Fu;
var qu;
var Ku;
var ju;
var Zu;
var Qu;
var Yu;
var Xu;
var Ju;
var ed;
var _o;
var wo;
var td;
var rd;
var nd;
var Ih;
var Ch;
var od;
var tn = V(() => {
  "use strict";
  J();
  re();
  Ce();
  oe();
  Sh = (t, e4, r, n, o, i, s) => {
    let u = Math.ceil(e4 / 4), d = "";
    typeof o == "string" ? d = `${o}(a)` : d = o("a");
    let c2 = O("inputData", r, [u], 4), p4 = U("outputData", n, [u], 4), m = [{ name: "vec_size", type: "u32" }];
    return s && m.push(...s), `
      ${t.registerUniforms(m).declareVariables(c2, p4)}

  ${i ?? ""}

  ${t.mainStart()}
    ${t.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.vec_size")}

    let a = ${c2.getByOffset("global_idx")};
    ${p4.setByOffset("global_idx", d)}
  }`;
  }, ge = (t, e4, r, n, o, i = t.dataType, s, u) => {
    let d = [{ type: 12, data: Math.ceil(k4.size(t.dims) / 4) }];
    return s && d.push(...s), { name: e4, shaderCache: { hint: o, inputDependencies: ["type"] }, getShaderSource: (c2) => Sh(c2, k4.size(t.dims), t.dataType, i, r, n, u), getRunData: (c2) => ({ outputs: [{ dims: t.dims, dataType: i }], dispatchGroup: { x: Math.ceil(k4.size(c2[0].dims) / 64 / 4) }, programUniforms: d }) };
  }, xu = (t) => {
    t.compute(ge(t.inputs[0], "Abs", "abs"));
  }, Su = (t) => {
    t.compute(ge(t.inputs[0], "Acos", "acos"));
  }, Tu = (t) => {
    t.compute(ge(t.inputs[0], "Acosh", "acosh"));
  }, Iu = (t) => {
    t.compute(ge(t.inputs[0], "Asin", "asin"));
  }, Cu = (t) => {
    t.compute(ge(t.inputs[0], "Asinh", "asinh"));
  }, Au = (t) => {
    t.compute(ge(t.inputs[0], "Atan", "atan"));
  }, Eu = (t) => {
    t.compute(ge(t.inputs[0], "Atanh", "atanh"));
  }, ku = (t) => ee(t), Pu = (t, e4) => {
    let r;
    switch (e4.to) {
      case 10:
        r = "vec4<f16>";
        break;
      case 1:
        r = "vec4<f32>";
        break;
      case 12:
        r = "vec4<u32>";
        break;
      case 6:
        r = "vec4<i32>";
        break;
      case 9:
        r = "vec4<bool>";
        break;
      default:
        throw new RangeError(`not supported type (specified in attribute 'to' from 'Cast' operator): ${e4.to}`);
    }
    t.compute(ge(t.inputs[0], "Cast", r, void 0, e4.cacheKey, e4.to));
  }, Th = (t) => {
    let e4, r, n = t.length >= 2 && t[1].data !== 0, o = t.length >= 3 && t[2].data !== 0;
    switch (t[0].dataType) {
      case 1:
        e4 = n ? t[1].getFloat32Array()[0] : -34028234663852886e22, r = o ? t[2].getFloat32Array()[0] : 34028234663852886e22;
        break;
      case 10:
        e4 = n ? t[1].getUint16Array()[0] : 64511, r = o ? t[2].getUint16Array()[0] : 31743;
        break;
      default:
        throw new Error("Unsupport data type");
    }
    return ee({ min: e4, max: r });
  }, Ou = (t, e4) => {
    let r = e4 || Th(t.inputs), n = ze(t.inputs[0].dataType);
    t.compute(ge(t.inputs[0], "Clip", (o) => `clamp(${o}, vec4<${n}>(uniforms.min), vec4<${n}>(uniforms.max))`, void 0, r.cacheKey, void 0, [{ type: t.inputs[0].dataType, data: r.min }, { type: t.inputs[0].dataType, data: r.max }], [{ name: "min", type: n }, { name: "max", type: n }]), { inputs: [0] });
  }, zu = (t) => {
    t.compute(ge(t.inputs[0], "Ceil", "ceil"));
  }, Bu = (t) => {
    t.compute(ge(t.inputs[0], "Cos", "cos"));
  }, Du = (t) => {
    t.compute(ge(t.inputs[0], "Cosh", "cosh"));
  }, or = (t) => ee(t), Mu = (t, e4) => {
    let r = ze(t.inputs[0].dataType);
    t.compute(ge(t.inputs[0], "Elu", (n) => `elu_vf32(${n})`, `
  const elu_alpha_ = ${r}(${e4.alpha});

  fn elu_f32(a: ${r}) -> ${r} {
  return select((exp(a) - 1.0) * elu_alpha_, a, a >= 0.0);
  }

  fn elu_vf32(v: vec4<${r}>) -> vec4<${r}> {
  return vec4(elu_f32(v.x), elu_f32(v.y), elu_f32(v.z), elu_f32(v.w));
  }`, e4.cacheKey));
  }, en = (t = "f32") => `
const r0: ${t} = 0.3275911;
const r1: ${t} = 0.254829592;
const r2: ${t} = -0.284496736;
const r3: ${t} = 1.421413741;
const r4: ${t} = -1.453152027;
const r5: ${t} = 1.061405429;

fn erf_vf32(v: vec4<${t}>) -> vec4<${t}> {
  let absv = abs(v);
  let x = 1.0 / (1.0 + r0 * absv);
  return sign(v) * (1.0 - ((((r5 * x + r4) * x + r3) * x + r2) * x + r1) * x * exp(-absv * absv));
}`, Ru = (t) => {
    let e4 = ze(t.inputs[0].dataType);
    t.compute(ge(t.inputs[0], "Erf", (r) => `erf_vf32(${r})`, en(e4)));
  }, Uu = (t) => {
    t.compute(ge(t.inputs[0], "Exp", "exp"));
  }, Nu = (t) => {
    t.compute(ge(t.inputs[0], "Floor", "floor"));
  }, Vu = (t) => {
    let e4 = ze(t.inputs[0].dataType);
    t.compute(ge(t.inputs[0], "Gelu", (r) => `0.5 * ${r} * (1.0 + erf_vf32(${r} * 0.7071067811865475))`, en(e4)));
  }, Lu = (t, e4) => {
    let r = ze(t.inputs[0].dataType);
    t.compute(ge(t.inputs[0], "LeakyRelu", (n) => `select(leaky_relu_alpha_ * ${n}, ${n}, ${n} >= vec4<${r}>(0.0))`, `const leaky_relu_alpha_ = ${r}(${e4.alpha});`, e4.cacheKey));
  }, Wu = (t) => {
    t.compute(ge(t.inputs[0], "Not", (e4) => `!${e4}`));
  }, Gu = (t) => {
    t.compute(ge(t.inputs[0], "Neg", (e4) => `-${e4}`));
  }, Hu = (t) => {
    t.compute(ge(t.inputs[0], "Reciprocal", (e4) => `1.0/${e4}`));
  }, Fu = (t) => {
    let e4 = ze(t.inputs[0].dataType);
    t.compute(ge(t.inputs[0], "Relu", (r) => `select(vec4<${e4}>(0.0), ${r}, ${r} > vec4<${e4}>(0.0))`));
  }, qu = (t) => {
    t.compute(ge(t.inputs[0], "Sigmoid", (e4) => `(1.0 / (1.0 + exp(-${e4})))`));
  }, Ku = (t) => ee(t), ju = (t, e4) => {
    let r = ze(t.inputs[0].dataType);
    t.compute(ge(t.inputs[0], "HardSigmoid", (n) => `max(vec4<${r}>(0.0), min(vec4<${r}>(1.0), ${e4.alpha} * ${n} + vec4<${r}>(${e4.beta})))`, void 0, e4.cacheKey));
  }, Zu = (t) => {
    t.compute(ge(t.inputs[0], "Sin", "sin"));
  }, Qu = (t) => {
    t.compute(ge(t.inputs[0], "Sinh", "sinh"));
  }, Yu = (t) => {
    t.compute(ge(t.inputs[0], "Sqrt", "sqrt"));
  }, Xu = (t) => {
    t.compute(ge(t.inputs[0], "Tan", "tan"));
  }, Ju = (t) => `sign(${t}) * (1 - exp(-2 * abs(${t}))) / (1 + exp(-2 * abs(${t})))`, ed = (t) => {
    t.compute(ge(t.inputs[0], "Tanh", Ju));
  }, _o = (t = "f32") => `
const fast_gelu_a: ${t} = 0.5;
const fast_gelu_b: ${t} = 0.7978845608028654;
const fast_gelu_c: ${t} = 0.035677408136300125;

fn tanh_v(v: vec4<${t}>) -> vec4<${t}> {
  return ${Ju("v")};
}
`, wo = (t) => `(fast_gelu_a + fast_gelu_a * tanh_v(${t} * (fast_gelu_c * ${t} * ${t} + fast_gelu_b))) * ${t}`, td = (t) => {
    let e4 = ze(t.inputs[0].dataType);
    t.compute(ge(t.inputs[0], "FastGelu", wo, _o(e4), void 0, t.inputs[0].dataType));
  }, rd = (t, e4) => {
    let r = ze(t.inputs[0].dataType);
    return t.compute(ge(t.inputs[0], "ThresholdedRelu", (n) => `select(vec4<${r}>(0.0), ${n}, ${n} > thresholded_relu_alpha_)`, `const thresholded_relu_alpha_ = vec4<${r}>(${e4.alpha});`, e4.cacheKey)), 0;
  }, nd = (t) => {
    t.compute(ge(t.inputs[0], "Log", "log"));
  }, Ih = (t, e4) => `
const alpha = vec4<${t}>(${e4});
const one = ${t}(1.0);
const zero = ${t}(0.0);

fn quick_gelu_impl(x: vec4<${t}>) -> vec4<${t}> {
  let v = x *alpha;
  var x1 : vec4<${t}>;
  for (var i = 0; i < 4; i = i + 1) {
    if (v[i] >= zero) {
      x1[i] = one / (one + exp(-v[i]));
    } else {
      x1[i] = one - one / (one + exp(v[i]));
    }
  }
  return x * x1;
}
`, Ch = (t) => `quick_gelu_impl(${t})`, od = (t, e4) => {
    let r = ze(t.inputs[0].dataType);
    t.compute(ge(t.inputs[0], "QuickGelu", Ch, Ih(r, e4.alpha), e4.cacheKey, t.inputs[0].dataType));
  };
});
var Ah;
var Eh;
var ad;
var sd = V(() => {
  "use strict";
  re();
  oe();
  tn();
  Ah = (t) => {
    if (t[0].dims.length !== 3) throw new Error("input should have 3 dimensions");
    if (![2560, 5120, 10240].includes(t[0].dims[2])) throw new Error("hidden state should be 2560, 5120 or 10240");
    if (t[1].dims.length !== 1) throw new Error("bias is expected to have 1 dimensions");
    if (t[0].dims[2] !== t[1].dims[0]) throw new Error("last dimension of input and bias are not the same");
  }, Eh = (t) => {
    let e4 = t[0].dims.slice();
    e4[2] = e4[2] / 2;
    let r = O("input", t[0].dataType, t[0].dims, 4), n = O("bias", t[0].dataType, [t[0].dims[2]], 4), o = U("output", t[0].dataType, e4, 4), i = k4.size(e4) / 4, s = we(t[0].dataType);
    return { name: "BiasSplitGelu", getRunData: () => ({ outputs: [{ dims: e4, dataType: t[0].dataType }], dispatchGroup: { x: Math.ceil(i / 64) } }), getShaderSource: (d) => `
  const M_SQRT2 = sqrt(2.0);
  const halfChannels = ${t[0].dims[2] / 4 / 2}u;

  ${d.declareVariables(r, n, o)}

  ${en(s)}

  ${d.mainStart()}
    ${d.guardAgainstOutOfBoundsWorkgroupSizes(i)}
    let biasIdx = global_idx % halfChannels;
    let batchIndex = global_idx / halfChannels;
    let inputOffset = biasIdx + batchIndex * halfChannels * 2;
    let valueLeft = input[inputOffset] + bias[biasIdx];
    let valueRight = input[inputOffset + halfChannels] + bias[biasIdx + halfChannels];
    let geluRight = valueRight * 0.5 * (erf_vf32(valueRight / M_SQRT2) + 1);

    ${o.setByOffset("global_idx", "valueLeft * geluRight")}
  }` };
  }, ad = (t) => {
    Ah(t.inputs), t.compute(Eh(t.inputs));
  };
});
var kh;
var Ph;
var dt;
var ud;
var dd;
var ld;
var cd;
var pd;
var md;
var fd;
var hd;
var gd;
var bd;
var yd = V(() => {
  "use strict";
  J();
  re();
  oe();
  kh = (t, e4, r, n, o, i, s, u, d, c2, p4, m) => {
    let g, y;
    typeof u == "string" ? g = y = ($, S) => `${u}((${$}),(${S}))` : typeof u == "function" ? g = y = u : (g = u.scalar, y = u.vector);
    let b = U("outputData", p4, n.length, 4), _ = O("aData", d, e4.length, 4), T = O("bData", c2, r.length, 4), x;
    if (o) if (i) {
      let $ = k4.size(e4) === 1, S = k4.size(r) === 1, I = e4.length > 0 && e4[e4.length - 1] % 4 === 0, E = r.length > 0 && r[r.length - 1] % 4 === 0;
      $ || S ? x = b.setByOffset("global_idx", y($ ? `${_.type.value}(${_.getByOffset("0")}.x)` : _.getByOffset("global_idx"), S ? `${T.type.value}(${T.getByOffset("0")}.x)` : T.getByOffset("global_idx"))) : x = `
            let outputIndices = ${b.offsetToIndices("global_idx * 4u")};
            let offsetA = ${_.broadcastedIndicesToOffset("outputIndices", b)};
            let offsetB = ${T.broadcastedIndicesToOffset("outputIndices", b)};
            ${b.setByOffset("global_idx", y(s || I ? _.getByOffset("offsetA / 4u") : `${_.type.value}(${_.getByOffset("offsetA / 4u")}[offsetA % 4u])`, s || E ? T.getByOffset("offsetB / 4u") : `${T.type.value}(${T.getByOffset("offsetB / 4u")}[offsetB % 4u])`))}
          `;
    } else x = b.setByOffset("global_idx", y(_.getByOffset("global_idx"), T.getByOffset("global_idx")));
    else {
      if (!i) throw new Error("no necessary to use scalar implementation for element-wise binary op implementation.");
      let $ = (S, I, E = "") => {
        let A = `aData[indexA${I}][componentA${I}]`, z = `bData[indexB${I}][componentB${I}]`;
        return `
            let outputIndices${I} = ${b.offsetToIndices(`global_idx * 4u + ${I}u`)};
            let offsetA${I} = ${_.broadcastedIndicesToOffset(`outputIndices${I}`, b)};
            let offsetB${I} = ${T.broadcastedIndicesToOffset(`outputIndices${I}`, b)};
            let indexA${I} = offsetA${I} / 4u;
            let indexB${I} = offsetB${I} / 4u;
            let componentA${I} = offsetA${I} % 4u;
            let componentB${I} = offsetB${I} % 4u;
            ${S}[${I}] = ${E}(${g(A, z)});
          `;
      };
      p4 === 9 ? x = `
            var data = vec4<u32>(0);
            ${$("data", 0, "u32")}
            ${$("data", 1, "u32")}
            ${$("data", 2, "u32")}
            ${$("data", 3, "u32")}
            outputData[global_idx] = dot(vec4<u32>(0x1, 0x100, 0x10000, 0x1000000), vec4<u32>(data));` : x = `
            ${$("outputData[global_idx]", 0)}
            ${$("outputData[global_idx]", 1)}
            ${$("outputData[global_idx]", 2)}
            ${$("outputData[global_idx]", 3)}
          `;
    }
    return `
        ${t.registerUniform("vec_size", "u32").declareVariables(_, T, b)}

        ${m ?? ""}

        ${t.mainStart()}
        ${t.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.vec_size")}
        ${x}
      }`;
  }, Ph = (t, e4, r, n, o, i, s = r.dataType) => {
    let u = r.dims.map(Number), d = n.dims.map(Number), c2 = !k4.areEqual(u, d), p4 = u, m = k4.size(u), g = false, y = false, b = [c2];
    if (c2) {
      let _ = ot.calcShape(u, d, false);
      if (!_) throw new Error("Can't perform binary op on the given tensors");
      p4 = _.slice(), m = k4.size(p4);
      let T = k4.size(u) === 1, x = k4.size(d) === 1, $ = u.length > 0 && u[u.length - 1] % 4 === 0, S = d.length > 0 && d[d.length - 1] % 4 === 0;
      b.push(T), b.push(x), b.push($), b.push(S);
      let I = 1;
      for (let E = 1; E < p4.length; E++) {
        let A = u[u.length - E], z = d[d.length - E];
        if (A === z) I *= A;
        else break;
      }
      I % 4 === 0 ? (y = true, g = true) : (T || x || $ || S) && (g = true);
    } else g = true;
    return b.push(g), { name: t, shaderCache: { hint: e4 + b.map((_) => _.toString()).join("_"), inputDependencies: ["rank", "rank"] }, getShaderSource: (_) => kh(_, u, d, p4, g, c2, y, o, r.dataType, n.dataType, s, i), getRunData: () => ({ outputs: [{ dims: p4, dataType: s }], dispatchGroup: { x: Math.ceil(m / 64 / 4) }, programUniforms: [{ type: 12, data: Math.ceil(k4.size(p4) / 4) }, ...W(u, d, p4)] }) };
  }, dt = (t, e4, r, n, o, i) => {
    t.compute(Ph(e4, o ?? "", t.inputs[0], t.inputs[1], r, n, i));
  }, ud = (t) => {
    dt(t, "Add", (e4, r) => `${e4}+${r}`);
  }, dd = (t) => {
    dt(t, "Div", (e4, r) => `${e4}/${r}`);
  }, ld = (t) => {
    dt(t, "Equal", { scalar: (e4, r) => `u32(${e4}==${r})`, vector: (e4, r) => `vec4<u32>(${e4}==${r})` }, void 0, void 0, 9);
  }, cd = (t) => {
    dt(t, "Mul", (e4, r) => `${e4}*${r}`);
  }, pd = (t) => {
    let e4 = O("input", t.inputs[0].dataType, t.inputs[0].dims).type.value;
    dt(t, "Pow", { scalar: (n, o) => `pow_custom(${n},${o})`, vector: (n, o) => `pow_vector_custom(${n},${o})` }, `
    fn pow_custom(a : ${e4}, b : ${e4}) -> ${e4} {
      if (b == ${e4}(0.0)) {
        return ${e4}(1.0);
      } else if (a < ${e4}(0.0) && f32(b) != floor(f32(b))) {
        return ${e4}(pow(f32(a), f32(b))); // NaN
      }
      return select(sign(a), ${e4}(1.0), round(f32(abs(b) % ${e4}(2.0))) != 1.0) * ${e4}(${e4 === "i32" ? "round" : ""}(pow(f32(abs(a)), f32(b))));
    }
    fn pow_vector_custom(a : vec4<${e4}>, b : vec4<${e4}>) -> vec4<${e4}> {
      // TODO: implement vectorized pow
      return vec4<${e4}>(pow_custom(a.x, b.x), pow_custom(a.y, b.y), pow_custom(a.z, b.z), pow_custom(a.w, b.w));
    }
      `);
  }, md = (t) => {
    dt(t, "Sub", (e4, r) => `${e4}-${r}`);
  }, fd = (t) => {
    dt(t, "Greater", { scalar: (e4, r) => `u32(${e4}>${r})`, vector: (e4, r) => `vec4<u32>(${e4}>${r})` }, void 0, void 0, 9);
  }, hd = (t) => {
    dt(t, "Less", { scalar: (e4, r) => `u32(${e4}<${r})`, vector: (e4, r) => `vec4<u32>(${e4}<${r})` }, void 0, void 0, 9);
  }, gd = (t) => {
    dt(t, "GreaterOrEqual", { scalar: (e4, r) => `u32(${e4}>=${r})`, vector: (e4, r) => `vec4<u32>(${e4}>=${r})` }, void 0, void 0, 9);
  }, bd = (t) => {
    dt(t, "LessOrEqual", { scalar: (e4, r) => `u32(${e4}<=${r})`, vector: (e4, r) => `vec4<u32>(${e4}<=${r})` }, void 0, void 0, 9);
  };
});
var zh;
var Bh;
var Dh;
var Mh;
var _d;
var wd;
var vd = V(() => {
  "use strict";
  J();
  re();
  Ce();
  oe();
  zh = (t, e4) => {
    if (!t || t.length < 1) throw new Error("too few inputs");
    let r = 0, n = t[r], o = n.dataType, i = n.dims.length;
    t.forEach((s, u) => {
      if (u !== r) {
        if (s.dataType !== o) throw new Error("input tensors should be one type");
        if (s.dims.length !== i) throw new Error("input tensors should have the same shape");
        s.dims.forEach((d, c2) => {
          if (c2 !== e4 && d !== n.dims[c2]) throw new Error("non concat dimensions must match");
        });
      }
    });
  }, Bh = (t, e4) => `
  fn calculateInputIndex(index: u32) -> u32 {
    let sizeInConcatAxis = array<u32, ${t}u>(${e4});
    for (var i: u32 = 0u; i < ${t}; i += 1u ) {
      if (index < sizeInConcatAxis[i]) {
        return i;
      }
    }
    return ${t}u;
  }`, Dh = (t, e4) => {
    let r = t.length, n = [];
    for (let o = 0; o < r; ++o) {
      let i = e4.setByOffset("global_idx", t[o].getByIndices("indices"));
      r === 1 ? n.push(i) : o === 0 ? n.push(`if (inputIndex == ${o}u) { ${i} }`) : o === r - 1 ? n.push(`else { ${i} }`) : n.push(`else if (inputIndex == ${o}) { ${i} }`);
    }
    return n.join(`
`);
  }, Mh = (t, e4, r, n) => {
    let o = k4.size(r), i = new Array(t.length), s = new Array(t.length), u = 0, d = [], c2 = [], p4 = [{ type: 12, data: o }];
    for (let _ = 0; _ < t.length; ++_) u += t[_].dims[e4], i[_] = u, c2.push(t[_].dims.length), s[_] = O(`input${_}`, n, c2[_]), d.push("rank"), p4.push({ type: 12, data: i[_] });
    for (let _ = 0; _ < t.length; ++_) p4.push(...W(t[_].dims));
    p4.push(...W(r));
    let m = U("output", n, r.length), g = m.indicesGet("indices", e4), y = Array.from(Array(i.length).keys()).map((_) => `uniforms.sizeInConcatAxis${_}`).join(","), b = (_) => `

  ${(() => {
      _.registerUniform("outputSize", "u32");
      for (let T = 0; T < t.length; T++) _.registerUniform(`sizeInConcatAxis${T}`, "u32");
      return _.declareVariables(...s, m);
    })()}

  ${Bh(i.length, y)}

  ${_.mainStart()}
    ${_.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}

    var indices = ${m.offsetToIndices("global_idx")};

    let inputIndex = calculateInputIndex(${g});
    if (inputIndex != 0u) {
      let sizeInConcatAxis = array<u32, ${i.length}u>(${y});
      ${g} -= sizeInConcatAxis[inputIndex - 1u];
    }

    ${Dh(s, m)}
  }`;
    return { name: "Concat", shaderCache: { hint: `${e4}`, inputDependencies: d }, getRunData: () => ({ outputs: [{ dims: r, dataType: n }], dispatchGroup: { x: Math.ceil(o / 64) }, programUniforms: p4 }), getShaderSource: b };
  }, _d = (t, e4) => {
    let r = t.inputs, n = r[0].dims, o = k4.normalizeAxis(e4.axis, n.length);
    zh(r, o);
    let i = n.slice();
    i[o] = r.reduce((u, d) => u + (d.dims.length > o ? d.dims[o] : 0), 0);
    let s = r.filter((u) => k4.size(u.dims) > 0);
    t.compute(Mh(s, o, i, r[0].dataType), { inputs: s });
  }, wd = (t) => ee({ axis: t.axis });
});
var Qe;
var Ye;
var Xe;
var rn;
var St = V(() => {
  "use strict";
  J();
  re();
  Qe = (t, e4, r = "f32") => {
    switch (t.activation) {
      case "Relu":
        return `value = max(value, ${e4}(0.0));`;
      case "Sigmoid":
        return `value = (${e4}(1.0) / (${e4}(1.0) + exp(-value)));`;
      case "Clip":
        return `value = clamp(value, ${e4}(${r}(uniforms.clip_min)), ${e4}(${r}(uniforms.clip_max)));`;
      case "HardSigmoid":
        return `value = max(${e4}(0.0), min(${e4}(1.0), ${r}(uniforms.alpha) * value + ${r}(uniforms.beta)));`;
      case "LeakyRelu":
        return `value = select(${r}(uniforms.alpha) * value, value, value >= ${e4}(0.0));`;
      case "Tanh":
        return `let e2x = exp(-2.0 * abs(value));
              value = sign(value) * (1.0 - e2x) / (1.0 + e2x);
        `;
      case "":
        return "";
      default:
        throw new Error(`Unsupported activation ${t.activation}`);
    }
  }, Ye = (t, e4) => {
    t.activation === "Clip" ? e4.push({ type: 1, data: t.clipMax }, { type: 1, data: t.clipMin }) : t.activation === "HardSigmoid" ? e4.push({ type: 1, data: t.alpha }, { type: 1, data: t.beta }) : t.activation === "LeakyRelu" && e4.push({ type: 1, data: t.alpha });
  }, Xe = (t, e4) => {
    t.activation === "Clip" ? e4.push({ name: "clip_max", type: "f32" }, { name: "clip_min", type: "f32" }) : t.activation === "HardSigmoid" ? e4.push({ name: "alpha", type: "f32" }, { name: "beta", type: "f32" }) : t.activation === "LeakyRelu" && e4.push({ name: "alpha", type: "f32" });
  }, rn = (t) => {
    let e4 = t?.activation || "";
    if (e4 === "HardSigmoid") {
      let [r, n] = t?.activation_params || [0.2, 0.5];
      return { activation: e4, alpha: r, beta: n };
    } else if (e4 === "Clip") {
      let [r, n] = t?.activation_params || [As, Es];
      return { activation: e4, clipMax: n, clipMin: r };
    } else if (e4 === "LeakyRelu") {
      let [r] = t?.activation_params || [0.01];
      return { activation: e4, alpha: r };
    }
    return { activation: e4 };
  };
});
var ke;
var $d;
var nn = V(() => {
  "use strict";
  ke = (t, e4) => {
    switch (t) {
      case 1:
        return e4;
      case 2:
        return `vec2<${e4}>`;
      case 3:
        return `vec3<${e4}>`;
      case 4:
        return `vec4<${e4}>`;
      default:
        throw new Error(`${t}-component is not supported.`);
    }
  }, $d = (t) => `
      ${t ? "value = value + getBiasByOutputCoords(coords);" : ""}
      `;
});
var xd;
var Sd = V(() => {
  "use strict";
  xd = (t) => `
fn getIndexFromCoords4D(coords : vec4<i32>, shape : vec4<i32>) -> i32 {
  return dot(coords, vec4<i32>(
      shape.y * shape.z * shape.w, shape.z * shape.w, shape.w, 1));
}
fn getOutputIndexFromCoords(coords : vec4<i32>) -> i32 {
  return dot(coords, vec4<i32>(
    i32(${t}.x), i32(${t}.y), i32(${t}.z), 1));
}
`;
});
var ir;
var on;
var an = V(() => {
  "use strict";
  J();
  re();
  oe();
  St();
  ir = (t, e4, r, n, o) => {
    let i = n - r;
    return `
      ${Array.from({ length: r }).map((s, u) => `
      if (${j(e4.shape, u, e4.rank)} != 1) {
        ${e4.indicesSet(t, u, j(o, u + i, n))}
      } else {
        ${e4.indicesSet(t, u, 0)}
      }`).join("")}
`;
  }, on = (t, e4, r, n, o = false, i) => {
    let s = t[0].dims, u = t[1].dims, d = s[s.length - 2], c2 = u[u.length - 1], p4 = s[s.length - 1], m = fe(c2), g = fe(p4), y = fe(d), b = k4.size(r) / m / y, _ = t.length > 2, T = n ? n.slice(0, -2) : r.slice(0, -2), $ = [k4.size(T), d, c2], S = [{ type: 12, data: b }, { type: 12, data: d }, { type: 12, data: c2 }, { type: 12, data: p4 }];
    Ye(e4, S), S.push(...W(T, s, u)), _ && S.push(...W(t[2].dims)), S.push(...W($));
    let I = (E) => {
      let A = Qr("batch_dims", t[0].dataType, T.length), z = O("a", t[0].dataType, s.length, g), v = O("b", t[1].dataType, u.length, m), R = U("output", t[0].dataType, $.length, m), N = we(R.type.tensor), F = Qe(e4, R.type.value, N), q = [z, v], X = "";
      if (_) {
        let Q = o ? m : 1;
        q.push(O("bias", t[2].dataType, t[2].dims.length, Q)), X = `${o ? `value += bias[col / ${Q}];` : `value += ${R.type.value}(bias[row + i]);`}`;
      }
      let B = [{ name: "output_size", type: "u32" }, { name: "M", type: "u32" }, { name: "N", type: "u32" }, { name: "K", type: "u32" }];
      Xe(e4, B);
      let L = () => {
        let Q = `var a_data: ${z.type.value};`;
        for (let Y = 0; Y < g; Y++) Q += `
              let b_data${Y} = b[(b_offset + (k + ${Y}) * uniforms.N + col) / ${m}];`;
        for (let Y = 0; Y < y; Y++) {
          Q += `a_data = a[(a_offset + (row + ${Y}) * uniforms.K + k) / ${g}];`;
          for (let Z = 0; Z < g; Z++) Q += `
            values[${Y}] = fma(${v.type.value}(a_data${g === 1 ? "" : `[${Z}]`}), b_data${Z}, values[${Y}]);
`;
        }
        return Q;
      };
      return `
  ${E.registerUniforms(B).registerInternalVariables(A).declareVariables(...q, R)}
  ${E.mainStart()}
    ${E.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    let col = (global_idx % (uniforms.N / ${m})) * ${m};
    var index1 = global_idx / (uniforms.N / ${m});
    let stride1 = uniforms.M / ${y};
    let row = (index1 % stride1) * ${y};
    let batch = index1 / stride1;

    ${r.length === 2 ? "" : `let batch_indices = ${A.offsetToIndices("batch")};`}

    var a_indices: ${z.type.indices};
    ${ir("a_indices", z, z.rank - 2, A.rank, "batch_indices")}
    ${z.indicesSet("a_indices", z.rank - 2, 0)}
    ${z.indicesSet("a_indices", z.rank - 1, 0)}
    let a_offset = ${z.indicesToOffset("a_indices")};

    var b_indices: ${v.type.indices};
    ${ir("b_indices", v, v.rank - 2, A.rank, "batch_indices")}
    ${v.indicesSet("b_indices", v.rank - 2, 0)}
    ${v.indicesSet("b_indices", v.rank - 1, 0)}
    let b_offset = ${v.indicesToOffset("b_indices")};
    var values: array<${R.type.value}, ${y}>;
    for (var k: u32 = 0u; k < uniforms.K; k = k + ${g}) {
      ${L()}
    }
    for (var i = 0u; i < ${y}u; i++) {
      var value = values[i];
      ${X}
      ${F}
      let cur_indices = ${R.type.indices}(batch, row + i, col);
      let offset = ${R.indicesToOffset("cur_indices")};
      ${R.setByOffset(`offset / ${m}`, "value")};
    }
  }
  `;
    };
    return { name: "MatMulNaive", shaderCache: { hint: `${e4.activation};${m};${g};${y};${o}`, inputDependencies: _ ? ["rank", "rank", "rank"] : ["rank", "rank"] }, getRunData: () => ({ outputs: [{ dims: i ? i(r) : r, dataType: t[0].dataType }], dispatchGroup: { x: Math.ceil(b / 64) }, programUniforms: S }), getShaderSource: I };
  };
});
var Rh;
var Uh;
var vo;
var Td;
var Nh;
var $o;
var Vh;
var ar;
var sn = V(() => {
  "use strict";
  J();
  re();
  oe();
  St();
  an();
  nn();
  Rh = (t, e4) => t ? `
        mm_Asub[inputRow][inputCol] = mm_readA(batch,
          kStart + inputRow,
          globalRowStart / innerElementSize + inputCol${e4 ? ", batchIndices" : ""});
        ` : `
        mm_Asub[inputRow][inputCol] = mm_readA(batch,
          globalRow + innerRow,
          kStart / innerElementSize + inputCol${e4 ? ", batchIndices" : ""});
        `, Uh = (t, e4) => t ? `
        let ACached0 = mm_Asub[k * innerElementSize][localRow];
        let ACached1 = mm_Asub[k * innerElementSize + 1][localRow];
        let ACached2 = mm_Asub[k * innerElementSize + 2][localRow];
        ${e4 === 3 ? "" : "let ACached3 = mm_Asub[k * innerElementSize + 3][localRow];"}
        for (var i = 0; i < rowPerThread; i = i + 1) {
          acc[i] = BCached0 * ACached0[i] + acc[i];
          acc[i] = BCached1 * ACached1[i] + acc[i];
          acc[i] = BCached2 * ACached2[i] + acc[i];
          ${e4 === 3 ? "" : "acc[i] = BCached3 * ACached3[i] + acc[i];"}
        }` : `
        for (var i = 0; i < rowPerThread; i = i + 1) {
          let ACached = mm_Asub[tileRow + i][k];
          acc[i] = BCached0 * ACached.x + acc[i];
          acc[i] = BCached1 * ACached.y + acc[i];
          acc[i] = BCached2 * ACached.z + acc[i];
          ${e4 === 3 ? "" : "acc[i] = BCached3 * ACached.w + acc[i];"}
        }`, vo = (t, e4, r = "f32", n, o = false, i = 32, s = false, u = 32) => {
    let d = e4[1] * t[1], c2 = e4[0] * t[0], p4 = o ? d : i, m = o ? i : d, g = p4 / e4[0], y = i / e4[1];
    if (!((o && g === 4 && t[1] === 4 || !o && (g === 3 || g === 4)) && p4 % e4[0] === 0 && i % e4[1] === 0 && t[0] === 4)) throw new Error(`If transposeA ${o} is true, innerElementSize ${g} and workPerThread[1] ${t[1]} must be 4.
      Otherwise, innerElementSize ${g} must be 3 or 4.
  tileAWidth ${p4} must be divisible by workgroupSize[0]${e4[0]}. tileInner ${i} must be divisible by workgroupSize[1] ${e4[1]}. colPerThread ${t[0]} must be 4.`);
    return `
var<workgroup> mm_Asub: array<array<vec${g}<${r}>, ${p4 / g}>, ${m}>;
var<workgroup> mm_Bsub: array<array<vec4<${r}>, ${c2 / t[0]}>, ${i}>;

const rowPerThread = ${t[1]};
const colPerThread = ${t[0]};
const innerElementSize = ${g};
const tileInner = ${i};

@compute @workgroup_size(${e4[0]}, ${e4[1]}, ${e4[2]})
fn main(@builtin(local_invocation_id) localId : vec3<u32>,
        @builtin(global_invocation_id) globalId : vec3<u32>,
        @builtin(workgroup_id) workgroupId : vec3<u32>) {
  let localRow = i32(localId.y);
  let tileRow = localRow * rowPerThread;
  let tileCol = i32(localId.x);

  let globalRow =i32(globalId.y) * rowPerThread;
  let globalCol = i32(globalId.x);
  let batch = ${s ? "0" : "i32(globalId.z)"};
  ${n ? `let batchIndices = ${n.offsetToIndices("u32(batch)")};` : ""}
  let globalRowStart = i32(workgroupId.y) * ${d};

  let num_tiles = ${s ? `${Math.ceil(u / i)}` : "(uniforms.dim_inner - 1) / tileInner + 1"};
  var kStart = ${s ? `i32(globalId.z) * ${u}` : "0"};

  var acc: array<vec4<${r}>, rowPerThread>;

  // Loop over shared dimension.
  let tileRowB = localRow * ${y};
  for (var t = 0; t < num_tiles; t = t + 1) {
      // Load one tile of A into local memory.
      for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
          let inputRow = tileRow + innerRow;
          let inputCol = tileCol;
          ${Rh(o, n)}
      }

      // Load one tile of B into local memory.
      for (var innerRow = 0; innerRow < ${y}; innerRow = innerRow + 1) {
          let inputRow = tileRowB + innerRow;
          let inputCol = tileCol;
          mm_Bsub[inputRow][inputCol] = mm_readB(batch, kStart + inputRow, globalCol${n ? ", batchIndices" : ""});
      }
      kStart = kStart + tileInner;
      workgroupBarrier();

      // Compute acc values for a single thread.
      for (var k = 0; k < tileInner / innerElementSize; k = k + 1) {
          let BCached0 = mm_Bsub[k * innerElementSize][tileCol];
          let BCached1 = mm_Bsub[k * innerElementSize + 1][tileCol];
          let BCached2 = mm_Bsub[k * innerElementSize + 2][tileCol];
          ${g === 3 ? "" : "let BCached3 = mm_Bsub[k * innerElementSize + 3][tileCol];"}

          ${Uh(o, g)}
      }

      workgroupBarrier();
  }

  for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
      mm_write(batch, globalRow + innerRow, globalCol, acc[innerRow]);
  }
}`;
  }, Td = (t, e4) => t ? `
            mm_Asub[inputRow][inputCol] = mm_readA(batch,
              kStart + inputRow,
              globalRowStart + inputCol${e4 ? ", batchIndices" : ""});
            ` : `
            mm_Asub[inputRow][inputCol] = mm_readA(batch,
              globalRowStart + inputRow,
              kStart + inputCol${e4 ? ", batchIndices" : ""});
            `, Nh = (t) => t ? "let ACached = mm_Asub[k][tileRow + innerRow];" : "let ACached = mm_Asub[tileRow + innerRow][k];", $o = (t, e4, r = "f32", n, o = false, i = 32, s = false, u = 32, d = false) => {
    let c2 = t[1] * e4[1], p4 = t[0] * e4[0], m = o ? c2 : i, g = o ? i : c2;
    if (!(g % e4[1] === 0 && m % e4[0] === 0 && i % e4[1] === 0)) throw new Error(`tileAHight ${g} must be divisible by workgroupSize[1]${e4[1]}, tileAWidth ${m} must be divisible by workgroupSize[0]${e4[0]}, tileInner ${i} must be divisible by workgroupSize[1]${e4[1]}`);
    let y = g / e4[1], b = m / e4[0], _ = i / e4[1], T = d ? `
    let localRow = i32(localId.y);
    let localCol = i32(localId.x);
    let globalRowStart = i32(workgroupId.y) * ${c2};
    let globalColStart = i32(workgroupId.x) * ${p4};

    // Loop over shared dimension.
    for (var t = 0; t < num_tiles; t = t + 1) {
      // Load one tile of A into local memory.
      for (var inputRow = localRow; inputRow < ${g}; inputRow = inputRow + ${e4[1]}) {
        for (var inputCol = localCol; inputCol < ${m}; inputCol = inputCol + ${e4[0]}) {
          ${Td(o, n)}
        }
      }
      // Load one tile of B into local memory.
      for (var inputRow = localRow; inputRow < ${i}; inputRow = inputRow + ${e4[1]}) {
            for (var inputCol = localCol; inputCol < ${p4}; inputCol = inputCol + ${e4[0]}) {
          mm_Bsub[inputRow][inputCol] = mm_readB(batch,
            kStart + inputRow,
            globalColStart + inputCol${n ? ", batchIndices" : ""});
        }
      }
      kStart = kStart + tileInner;
      workgroupBarrier();

      // Compute acc values for a single thread.
      var BCached : array<${r}, colPerThread>;
      for (var k = 0; k < tileInner; k = k + 1) {
        for (var inner = 0; inner < colPerThread; inner = inner + 1) {
          BCached[inner] = mm_Bsub[k][localCol + inner * ${e4[0]}];
        }
        for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
          let ACached = ${o ? `mm_Asub[k][localRow + innerRow * ${e4[1]}];` : `mm_Asub[localRow + innerRow * ${e4[1]}][k];`}
          for (var innerCol = 0; innerCol < colPerThread; innerCol = innerCol + 1) {
            acc[innerRow][innerCol] = acc[innerRow][innerCol] +
                ACached * BCached[innerCol];
          }
        }
      }
      workgroupBarrier();
    }
    for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
      let gRow = globalRowStart + localRow + innerRow * ${e4[1]};
      for (var innerCol = 0; innerCol < colPerThread; innerCol = innerCol + 1) {
        let gCol = globalColStart + localCol + innerCol * ${e4[0]};
        mm_write(batch, gRow, gCol, acc[innerRow][innerCol]);
      }
    }
    ` : `
let tileRow = i32(localId.y) * rowPerThread;
let tileCol = i32(localId.x) * colPerThread;

let globalRow = i32(globalId.y) * rowPerThread;
let globalCol = i32(globalId.x) * colPerThread;
let globalRowStart = i32(workgroupId.y) * ${c2};

let tileRowA = i32(localId.y) * ${y};
let tileColA = i32(localId.x) * ${b};
let tileRowB = i32(localId.y) * ${_};
// Loop over shared dimension.
for (var t = 0; t < num_tiles; t = t + 1) {
  // Load one tile of A into local memory.
  for (var innerRow = 0; innerRow < ${y}; innerRow = innerRow + 1) {
    for (var innerCol = 0; innerCol < ${b}; innerCol = innerCol + 1) {
      let inputRow = tileRowA + innerRow;
      let inputCol = tileColA + innerCol;
      ${Td(o, n)}
    }
  }

  // Load one tile of B into local memory.
  for (var innerRow = 0; innerRow < ${_}; innerRow = innerRow + 1) {
    for (var innerCol = 0; innerCol < colPerThread; innerCol = innerCol + 1) {
      let inputRow = tileRowB + innerRow;
      let inputCol = tileCol + innerCol;
      mm_Bsub[inputRow][inputCol] = mm_readB(batch,
        kStart + inputRow,
        globalCol + innerCol${n ? ", batchIndices" : ""});
    }
  }
  kStart = kStart + tileInner;
  workgroupBarrier();

  // Compute acc values for a single thread.
  var BCached : array<${r}, colPerThread>;
  for (var k = 0; k < tileInner; k = k + 1) {
    for (var inner = 0; inner < colPerThread; inner = inner + 1) {
      BCached[inner] = mm_Bsub[k][tileCol + inner];
    }

    for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
      ${Nh(o)}
      for (var innerCol = 0; innerCol < colPerThread; innerCol = innerCol + 1) {
        acc[innerRow][innerCol] = acc[innerRow][innerCol] + ACached * BCached[innerCol];
      }
    }
  }

  workgroupBarrier();
}

for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
  for (var innerCol = 0; innerCol < colPerThread; innerCol = innerCol + 1) {
    mm_write(batch, globalRow + innerRow, globalCol + innerCol,
        acc[innerRow][innerCol]);
  }
}
`;
    return `
  var<workgroup> mm_Asub : array<array<${r}, ${m}>, ${g}>;
  var<workgroup> mm_Bsub : array<array<${r}, ${p4}>, ${i}>;
  const rowPerThread = ${t[1]};
  const colPerThread = ${t[0]};
  const tileInner = ${i};

@compute @workgroup_size(${e4[0]}, ${e4[1]}, ${e4[2]})
fn main(@builtin(local_invocation_id) localId : vec3<u32>,
        @builtin(global_invocation_id) globalId : vec3<u32>,
        @builtin(workgroup_id) workgroupId : vec3<u32>) {
    let batch = ${s ? "0" : "i32(globalId.z)"};
    ${n ? `let batchIndices = ${n.offsetToIndices("u32(batch)")};` : ""}
    let num_tiles = ${s ? `${Math.ceil(u / i)}` : "(uniforms.dim_inner - 1) / tileInner + 1"};
    var kStart = ${s ? `i32(globalId.z) * ${u}` : "0"};

    var acc : array<array<${r}, colPerThread>, rowPerThread>;
    ${T}
  }
`;
  }, Vh = (t, e4, r, n, o = false) => {
    let [i, s, u, d] = n, c2 = we(n[0].type.tensor);
    return `
    fn mm_readA(batch: i32, row: i32, colIn: i32, batchIndices: ${i.type.indices}) -> ${ke(t, c2)} {
      var value = ${ke(t, c2)}(0.0);
      let col = colIn * ${t};
      if(row < uniforms.dim_a_outer && col < uniforms.dim_inner)
      {
        var aIndices: ${s.type.indices};
        ${ir("aIndices", s, s.rank - 2, i.rank, "batchIndices")}
        ${s.indicesSet("aIndices", s.rank - 2, "u32(row)")}
        ${s.indicesSet("aIndices", s.rank - 1, "u32(colIn)")}
        value = ${s.getByIndices("aIndices")};
      }
      return value;
    }

    fn mm_readB(batch: i32, row: i32, colIn: i32, batchIndices: ${i.type.indices}) -> ${ke(t, c2)} {
      var value = ${ke(t, c2)}(0.0);
      let col = colIn * ${t};
      if(row < uniforms.dim_inner && col < uniforms.dim_b_outer)
      {
        var bIndices: ${u.type.indices};
        ${ir("bIndices", u, u.rank - 2, i.rank, "batchIndices")}
        ${u.indicesSet("bIndices", u.rank - 2, "u32(row)")}
        ${u.indicesSet("bIndices", u.rank - 1, "u32(colIn)")}
        value = ${u.getByIndices("bIndices")};
      }
      return value;
    }

    fn mm_write(batch: i32, row: i32, colIn: i32, valueIn: ${ke(t, c2)}) {
      let col = colIn * ${t};
      if (row < uniforms.dim_a_outer && col < uniforms.dim_b_outer) {
        var value = valueIn;
        let coords = vec3<i32>(batch, row, colIn);
        ${e4 ? `value = value + ${o ? "bias[colIn]" : `${ke(t, c2)}(bias[row])`};` : ""}
        ${r}
        ${d.setByIndices("vec3<u32>(coords)", "value")}
      }
    }
    `;
  }, ar = (t, e4, r, n, o = false, i) => {
    let s = t[0].dims, u = t[1].dims, d = s.slice(0, -2), c2 = u.slice(0, -2), p4 = n ? n.slice(0, -2) : r.slice(0, -2), m = k4.size(p4), g = s[s.length - 2], y = s[s.length - 1], b = u[u.length - 1], _ = y % 4 === 0 && b % 4 === 0, T = g <= 8 ? [4, 1, 1] : [4, 4, 1], x = [8, 8, 1], $ = [Math.ceil(b / x[0] / T[0]), Math.ceil(g / x[1] / T[1]), Math.ceil(m / x[2] / T[2])], S = _ ? 4 : 1, I = [...d, g, y / S], E = I.length, A = [...c2, y, b / S], z = A.length, v = [m, g, b / S], R = [{ type: 6, data: g }, { type: 6, data: b }, { type: 6, data: y }];
    Ye(e4, R), R.push(...W(p4, I, A));
    let N = ["rank", "rank"], F = t.length > 2;
    F && (R.push(...W(t[2].dims)), N.push("rank")), R.push(...W(v));
    let q = (X) => {
      let B = p4.length, L = Qr("batchDims", t[0].dataType, B, 1), Q = we(t[0].dataType), Y = O("a", t[0].dataType, E, S), Z = O("b", t[1].dataType, z, S), te = U("result", t[0].dataType, v.length, S), ae = [Y, Z];
      if (F) {
        let G = o ? S : 1;
        ae.push(O("bias", t[2].dataType, t[2].dims.length, G));
      }
      let le = [{ name: "dim_a_outer", type: "i32" }, { name: "dim_b_outer", type: "i32" }, { name: "dim_inner", type: "i32" }];
      Xe(e4, le);
      let Me = we(te.type.tensor), ve = Qe(e4, te.type.value, Me), M3 = Vh(S, F, ve, [L, Y, Z, te], o);
      return `
  ${X.registerUniforms(le).registerInternalVariables(L).declareVariables(...ae, te)}
  ${M3}
  ${_ ? vo(T, x, Q, L) : $o(T, x, Q, L)}
                   `;
    };
    return { name: "MatMul", shaderCache: { hint: `${T};${e4.activation};${_};${o}`, inputDependencies: N }, getRunData: () => ({ outputs: [{ dims: i ? i(r) : r, dataType: t[0].dataType }], dispatchGroup: { x: $[0], y: $[1], z: $[2] }, programUniforms: R }), getShaderSource: q };
  };
});
var Lh;
var Id;
var Cd = V(() => {
  "use strict";
  J();
  nt();
  oe();
  St();
  nn();
  Sd();
  sn();
  Lh = (t, e4, r, n, o = false, i, s = 4, u = 4, d = 4, c2 = "f32") => {
    let p4 = (N) => {
      switch (N) {
        case 1:
          return "resData = x[xIndex];";
        case 3:
          return `resData = vec3<${c2}>(x[xIndex], x[xIndex + 1], x[xIndex + 2]);`;
        case 4:
          return "resData = x[xIndex / 4];";
        default:
          throw new Error(`innerElementSize ${N} is not supported.`);
      }
    }, m = (N) => {
      switch (N) {
        case 1:
          return "return w[row * i32(uniforms.w_shape[3]) + colIn];";
        case 4:
          return "return w[row * i32(uniforms.w_shape[3]) / 4 + colIn];";
        default:
          throw new Error(`innerElementSize ${N} is not supported.`);
      }
    }, g = t ? `
    let coord = vec4<i32>(batch, xRow, xCol, xCh);
    ` : `
    let coord = vec4<i32>(batch, xCh, xRow, xCol);
    `, y = t ? `
    let coords = vec4<i32>(
      batch,
      row / outWidth,
      row % outWidth,
      col);
    ` : `
    let coords = vec4<i32>(
      batch,
      row,
      col / outWidth,
      col % outWidth);
    `, b = t ? "i32(uniforms.x_shape[1])" : "i32(uniforms.x_shape[2])", _ = t ? "i32(uniforms.x_shape[2])" : "i32(uniforms.x_shape[3])", T = t ? "row" : "col", x = t ? "col" : "row", $ = `
    let inChannels = i32(uniforms.w_shape[2]);
    let outWidth = ${t ? "i32(uniforms.result_shape[2])" : "i32(uniforms.result_shape[3])"};
    let outRow = ${T} / outWidth;
    let outCol = ${T} % outWidth;

    let WRow = ${x} / (i32(uniforms.w_shape[1]) * inChannels);
    let WCol = ${x} / inChannels % i32(uniforms.w_shape[1]);
    let xRow = outRow * uniforms.stride[0] + uniforms.dilation[0] * WRow - uniforms.pad[0];
    let xCol = outCol * uniforms.stride[1] + uniforms.dilation[1] * WCol - uniforms.pad[1];
    let xCh = ${x} % inChannels;
    var resData = ${ke(s, c2)}(0.0);
    // The bounds checking is always needed since we use it to pad zero for
    // the 'same' padding type.
    if (xRow >= 0 && xRow < ${b} && xCol >= 0 && xCol < ${_}) {
      ${g}
      let xIndex = getIndexFromCoords4D(coord, vec4<i32>(uniforms.x_shape));
      ${p4(s)}
    }
    return resData;`, S = t ? e4 && n ? `
    let col = colIn * ${s};
    ${$}` : `
    let col = colIn * ${s};
    if (row < uniforms.dim_a_outer && col < uniforms.dim_inner) {
      ${$}
    }
    return ${ke(s, c2)}(0.0);` : n && r ? `
    let col = colIn * ${s};
    ${$}` : `
    let col = colIn * ${s};
    if (row < uniforms.dim_inner && col < uniforms.dim_b_outer) {
      ${$}
    }
    return ${ke(s, c2)}(0.0);`, I = t ? n && r ? m(u) : `
    let col = colIn * ${u};
    if (row < uniforms.dim_inner && col < uniforms.dim_b_outer) {
      ${m(u)}
    }
    return ${ke(u, c2)}(0.0);` : `
    let col = colIn * ${u};
    if (row < uniforms.dim_inner && col < uniforms.dim_a_outer) {
      ${m(u)}
    }
    return ${ke(u, c2)}(0.0);`, E = ke(d, c2), A = t ? ke(s, c2) : ke(u, c2), z = t ? ke(u, c2) : ke(s, c2), v = Qe(i, E, c2);
    return `
    fn mm_readA(batch: i32, row : i32, colIn : i32) -> ${A} {
      ${t ? S : I}
    }

    fn mm_readB(batch: i32, row : i32, colIn : i32) -> ${z} {
      ${t ? I : S}
    }

    fn mm_write(batch: i32, row : i32, colIn : i32, valueIn : ${E}) {
      let col = colIn * ${d};
      if (row < uniforms.dim_a_outer && col < uniforms.dim_b_outer)
      {
      var value = valueIn;
      let outWidth = ${t ? "i32(uniforms.result_shape[2])" : "i32(uniforms.result_shape[3])"};
      ${y}
      ${$d(o)}
      ${v}
      setOutputAtCoords(coords[0], coords[1], coords[2], coords[3], value);
      }
    }`;
  }, Id = (t, e4, r, n, o, i, s, u, d) => {
    let c2 = e4.format === "NHWC", p4 = c2 ? t[0].dims[3] : t[0].dims[1], m = r[0], g = c2 ? r[2] : r[3], y = c2 ? r[1] : r[2], b = c2 ? r[3] : r[1], _ = c2 && (p4 % 4 === 0 || p4 % 3 === 0) && b % 4 === 0, T = c2 ? b : g * y, x = c2 ? g * y : b, $ = [8, 8, 1], S = n <= 8 ? [4, 1, 1] : [4, 4, 1], I = [Math.ceil(T / $[0] / S[0]), Math.ceil(x / $[1] / S[1]), Math.ceil(m / $[2] / S[2])];
    ie("verbose", () => `[conv2d_mm_webgpu] dispatch = ${I}`);
    let E = _ ? c2 && p4 % 4 !== 0 ? 3 : 4 : 1, A = $[1] * S[1], z = $[0] * S[0], v = Math.max($[0] * E, $[1]), R = n % A === 0, N = o % z === 0, F = i % v === 0, q = _ ? [E, 4, 4] : [1, 1, 1], X = [{ type: 6, data: n }, { type: 6, data: o }, { type: 6, data: i }, { type: 6, data: [e4.pads[0], e4.pads[1]] }, { type: 6, data: e4.strides }, { type: 6, data: e4.dilations }];
    Ye(e4, X), X.push(...W(t[0].dims, t[1].dims));
    let B = ["rank", "rank"];
    s && (X.push(...W(t[2].dims)), B.push("rank")), X.push(...W(r));
    let L = (Q) => {
      let Y = [{ name: "dim_a_outer", type: "i32" }, { name: "dim_b_outer", type: "i32" }, { name: "dim_inner", type: "i32" }, { name: "pad", type: "i32", length: 2 }, { name: "stride", type: "i32", length: 2 }, { name: "dilation", type: "i32", length: 2 }];
      Xe(e4, Y);
      let Z = _ ? 4 : 1, te = we(t[0].dataType), ae = `
      fn setOutputAtIndex(flatIndex : i32, value : ${_ ? `vec4<${te}>` : te}) {
        result[flatIndex] = ${_ ? `vec4<${te}>` : te}(value);
      }
      fn setOutputAtCoords(d0 : i32, d1 : i32, d2 : i32, d3 : i32, value : ${_ ? `vec4<${te}>` : te}) {
        let flatIndex = getOutputIndexFromCoords(vec4<i32>(d0, d1, d2, d3));
        setOutputAtIndex(flatIndex ${_ ? "/ 4" : ""}, value);
      }`, le = O("x", t[0].dataType, t[0].dims.length, E === 3 ? 1 : E), Me = O("w", t[1].dataType, t[1].dims.length, Z), ve = [le, Me], M3 = U("result", t[0].dataType, r.length, Z);
      if (s) {
        let G = O("bias", t[2].dataType, t[2].dims.length, Z);
        ve.push(G), ae += `
        fn getBiasByOutputCoords(coords : vec4<i32>) -> ${_ ? `vec4<${te}>` : te} {
          return bias[coords.${c2 ? "w" : "y"}${_ ? "/ 4" : ""}];
        }`;
      }
      return `
        ${xd("uniforms.result_strides")}
        //struct Uniforms { xShape : vec4<i32>, wShape : vec4<i32>, outShape : vec4<i32>,
        //  outShapeStrides: vec3<i32>, filterDims : vec2<i32>, pad : vec2<i32>, stride : vec2<i32>,
        //  dilation : vec2<i32>, dimAOuter : i32, dimBOuter : i32, dimInner : i32 };
        ${Q.registerUniforms(Y).declareVariables(...ve, M3)}
        ${ae}
        ${Lh(c2, R, N, F, s, e4, q[0], q[1], q[2], te)}
        ${_ ? vo(S, $, te, void 0, !c2, v) : $o(S, $, te, void 0, !c2, v, false, void 0, u)}`;
    };
    return { name: "Conv2DMatMul", shaderCache: { hint: `${e4.cacheKey};${E};${_};${R};${N};${F};${A};${z};${v}`, inputDependencies: B }, getRunData: () => ({ outputs: [{ dims: d ? d(r) : r, dataType: t[0].dataType }], dispatchGroup: { x: I[0], y: I[1], z: I[2] }, programUniforms: X }), getShaderSource: L };
  };
});
var Wh;
var Ad;
var un3;
var Gh;
var Ed;
var Hh;
var kd;
var Pd;
var Od = V(() => {
  "use strict";
  J();
  nt();
  re();
  oe();
  St();
  nn();
  Wh = (t) => {
    let e4 = 1;
    for (let r = 0; r < t.length; r++) e4 *= t[r];
    return e4;
  }, Ad = (t) => typeof t == "number" ? [t, t, t] : t, un3 = (t, e4) => e4 <= 1 ? t : t + (t - 1) * (e4 - 1), Gh = (t, e4, r, n = 1) => {
    let o = un3(e4, n);
    return Math.floor((t[0] * (r - 1) - r + o) / 2);
  }, Ed = (t, e4, r, n, o) => {
    o == null && (o = Gh(t, e4[0], n[0]));
    let i = [0, 0, 0, r];
    for (let s = 0; s < 3; s++) t[s] + 2 * o >= e4[s] && (i[s] = Math.trunc((t[s] - e4[s] + 2 * o) / n[s] + 1));
    return i;
  }, Hh = (t, e4, r, n, o, i, s, u, d, c2) => {
    let p4, m, g, y;
    if (t === "VALID" && (t = 0), typeof t == "number") {
      p4 = { top: t, bottom: t, left: t, right: t, front: t, back: t };
      let b = Ed([e4, r, n, 1], [u, d, c2], 1, [o, i, s], t);
      m = b[0], g = b[1], y = b[2];
    } else if (Array.isArray(t)) {
      if (!t.every((_, T, x) => _ === x[0])) throw Error(`Unsupported padding parameter: ${t}`);
      p4 = { top: t[0], bottom: t[1], left: t[2], right: t[3], front: t[4], back: t[5] };
      let b = Ed([e4, r, n, 1], [u, d, c2], 1, [o, i, s], t[0]);
      m = b[0], g = b[1], y = b[2];
    } else if (t === "SAME_UPPER") {
      m = Math.ceil(e4 / o), g = Math.ceil(r / i), y = Math.ceil(n / s);
      let b = (m - 1) * o + u - e4, _ = (g - 1) * i + d - r, T = (y - 1) * s + c2 - n, x = Math.floor(b / 2), $ = b - x, S = Math.floor(_ / 2), I = _ - S, E = Math.floor(T / 2), A = T - E;
      p4 = { top: S, bottom: I, left: E, right: A, front: x, back: $ };
    } else throw Error(`Unknown padding parameter: ${t}`);
    return { padInfo: p4, outDepth: m, outHeight: g, outWidth: y };
  }, kd = (t, e4, r, n, o, i = false, s = "channelsLast") => {
    let u, d, c2, p4, m;
    if (s === "channelsLast") [u, d, c2, p4, m] = t;
    else if (s === "channelsFirst") [u, m, d, c2, p4] = t;
    else throw new Error(`Unknown dataFormat ${s}`);
    let [g, , y, b, _] = e4, [T, x, $] = Ad(r), [S, I, E] = Ad(n), A = un3(y, S), z = un3(b, I), v = un3(_, E), { padInfo: R, outDepth: N, outHeight: F, outWidth: q } = Hh(o, d, c2, p4, T, x, $, A, z, v), X = i ? g * m : g, B = [0, 0, 0, 0, 0];
    return s === "channelsFirst" ? B = [u, X, N, F, q] : s === "channelsLast" && (B = [u, N, F, q, X]), { batchSize: u, dataFormat: s, inDepth: d, inHeight: c2, inWidth: p4, inChannels: m, outDepth: N, outHeight: F, outWidth: q, outChannels: X, padInfo: R, strideDepth: T, strideHeight: x, strideWidth: $, filterDepth: y, filterHeight: b, filterWidth: _, effectiveFilterDepth: A, effectiveFilterHeight: z, effectiveFilterWidth: v, dilationDepth: S, dilationHeight: I, dilationWidth: E, inShape: t, outShape: B, filterShape: e4 };
  }, Pd = (t, e4, r, n, o, i) => {
    let s = i === "channelsLast", u = s ? t[0].dims[3] : t[0].dims[1], d = false, c2 = [64, 1, 1], p4 = { x: r.map(($, S) => S) }, m = [Math.ceil(Wh(p4.x.map(($) => r[$])) / c2[0]), 1, 1];
    ie("verbose", () => `[conv3d_naive_webgpu] dispatch = ${m}`);
    let g = d ? s && u % 4 !== 0 ? 3 : 4 : 1, y = k4.size(r), b = [{ type: 12, data: y }, { type: 12, data: n }, { type: 12, data: o }, { type: 12, data: e4.strides }, { type: 12, data: e4.dilations }];
    Ye(e4, b), b.push(...W(t[0].dims, t[1].dims));
    let _ = ["rank", "rank"], T = t.length === 3;
    T && (b.push(...W(t[2].dims)), _.push("rank")), b.push(...W(r));
    let x = ($) => {
      let S = [{ name: "output_size", type: "u32" }, { name: "filter_dims", type: "u32", length: n.length }, { name: "pads", type: "u32", length: o.length }, { name: "strides", type: "u32", length: e4.strides.length }, { name: "dilations", type: "u32", length: e4.dilations.length }];
      Xe(e4, S);
      let I = d ? 4 : 1, E = we(t[0].dataType), A = O("x", t[0].dataType, t[0].dims.length, g === 3 ? 1 : g), z = O("W", t[1].dataType, t[1].dims.length, I), v = [A, z], R = U("result", t[0].dataType, r.length, I), N = "";
      if (T) {
        let X = O("bias", t[2].dataType, t[2].dims.length, I);
        v.push(X), N += `
        fn getBiasByOutputCoords(coords : array<u32, 5>) -> ${d ? `vec4<${E}>` : E} {
          return bias[${s ? j("coords", 4, 5) : j("coords", 1, 5)}${d ? "/ 4" : ""}];
        }`;
      }
      let F = ke(g, E), q = Qe(e4, F, E);
      return `
            ${N}
            fn getX(d0 : u32, d1 : u32, d2 : u32, d3 : u32, d4 : u32) -> f32 {
              let aIndices = array<u32, 5>(d0, d1, d2, d3, d4);
              return ${A.getByIndices("aIndices")};
            }
            fn getW(d0 : u32, d1 : u32, d2 : u32, d3 : u32, d4 : u32) -> f32 {
              let aIndices = array<u32, 5>(d0, d1, d2, d3, d4);
              return ${z.getByIndices("aIndices")};
            }
          ${$.registerUniforms(S).declareVariables(...v, R)}
          ${$.mainStart()}
          ${$.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
              let coords = ${R.offsetToIndices("global_idx")};
              let batch = ${j("coords", 0, A.rank)};
              let d2 = ${s ? j("coords", A.rank - 1, A.rank) : j("coords", 1, A.rank)};
              let xFRCCorner = vec3<u32>(${s ? j("coords", 1, A.rank) : j("coords", 2, A.rank)},
              ${s ? j("coords", 2, A.rank) : j("coords", 3, A.rank)},
              ${s ? j("coords", 3, A.rank) : j("coords", 4, A.rank)}) * uniforms.strides - uniforms.pads;
              let xFCorner = xFRCCorner.x;
              let xRCorner = xFRCCorner.y;
              let xCCorner = xFRCCorner.z;
              let xShapeY = ${s ? j("uniforms.x_shape", 1, A.rank) : j("uniforms.x_shape", 2, A.rank)};
              let xShapeZ = ${s ? j("uniforms.x_shape", 2, A.rank) : j("uniforms.x_shape", 3, A.rank)};
              let xShapeW = ${s ? j("uniforms.x_shape", 3, A.rank) : j("uniforms.x_shape", 4, A.rank)};
              let xShapeU = ${s ? j("uniforms.x_shape", 4, A.rank) : j("uniforms.x_shape", 1, A.rank)};
              let inputDepthNearestVec4 = (xShapeU / 4) * 4;
              let inputDepthVec4Remainder = xShapeU % 4;

              var value = 0.0;
              for (var wF = 0u; wF < uniforms.filter_dims[0]; wF++) {
                let xF = xFCorner + wF * uniforms.dilations[0];
                if (xF < 0 || xF >= xShapeY) {
                  continue;
                }

                for (var wR = 0u; wR < uniforms.filter_dims[1]; wR++) {
                  let xR = xRCorner + wR * uniforms.dilations[1];
                  if (xR < 0 || xR >= xShapeZ) {
                    continue;
                  }

                  for (var wC = 0u; wC < uniforms.filter_dims[2]; wC++) {
                    let xC = xCCorner + wC * uniforms.dilations[2];
                    if (xC < 0 || xC >= xShapeW) {
                      continue;
                    }

                    for (var d1 = 0u; d1 < inputDepthNearestVec4; d1 += 4) {
                      ${s ? `let xValues = vec4<f32>(
                               getX(batch, xF, xR, xC, d1),
                               getX(batch, xF, xR, xC, d1 + 1),
                               getX(batch, xF, xR, xC, d1 + 2),
                               getX(batch, xF, xR, xC, d1 + 3));
                            ` : `let xValues = vec4<f32>(
                               getX(batch, d1, xF, xR, xC),
                               getX(batch, d1 + 1, xF, xR, xC),
                               getX(batch, d1 + 2, xF, xR, xC),
                               getX(batch, d1 + 3, xF, xR, xC));
                            `}
                            let wValues = vec4<f32>(
                              getW(d2, d1, wF, wR, wC),
                              getW(d2, d1 + 1, wF, wR, wC),
                              getW(d2, d1 + 2, wF, wR, wC),
                              getW(d2, d1 + 3, wF, wR, wC));
                      value += dot(xValues, wValues);
                    }
                    if (inputDepthVec4Remainder == 1) {
                        ${s ? `value += getX(batch, xF, xR, xC, inputDepthNearestVec4)
                          * getW(d2, inputDepthNearestVec4, wF, wR, wC);` : `value += getX(batch, inputDepthNearestVec4, xF, xR, xC)
                          * getW(d2, inputDepthNearestVec4, wF, wR, wC);`}
                    } else if (inputDepthVec4Remainder == 2) {
                      ${s ? `let xValues = vec2<f32>(
                        getX(batch, xF, xR, xC, inputDepthNearestVec4),
                        getX(batch, xF, xR, xC, inputDepthNearestVec4 + 1));
                      ` : `let xValues = vec2<f32>(
                        getX(batch, inputDepthNearestVec4, xF, xR, xC),
                        getX(batch, inputDepthNearestVec4 + 1, xF, xR, xC));
                    `}
                    let wValues = vec2<f32>(
                      getW(d2, inputDepthNearestVec4, wF, wR, wC),
                      getW(d2, inputDepthNearestVec4 + 1, wF, wR, wC));
                      value += dot(xValues, wValues);
                    } else if (inputDepthVec4Remainder == 3) {
                      ${s ? `let xValues = vec3<f32>(
                        getX(batch, xF, xR, xC, inputDepthNearestVec4),
                        getX(batch, xF, xR, xC, inputDepthNearestVec4 + 1),
                        getX(batch, xF, xR, xC, inputDepthNearestVec4 + 2));
                      ` : `let xValues = vec3<f32>(
                        getX(batch, inputDepthNearestVec4, xF, xR, xC),
                        getX(batch, inputDepthNearestVec4 + 1, xF, xR, xC),
                        getX(batch, inputDepthNearestVec4 + 2, xF, xR, xC));
                    `}
                    let wValues = vec3<f32>(
                      getW(d2, inputDepthNearestVec4, wF, wR, wC),
                      getW(d2, inputDepthNearestVec4 + 1, wF, wR, wC),
                      getW(d2, inputDepthNearestVec4 + 2, wF, wR, wC));
                      value += dot(xValues, wValues);
                    }
                  }
                }
              }
              ${T ? "value = value + getBiasByOutputCoords(coords)" : ""};
              ${q}
              result[global_idx] = f32(value);
          }`;
    };
    return { name: "Conv3DNaive", shaderCache: { hint: `${e4.cacheKey};${s};${g};${T}`, inputDependencies: _ }, getRunData: () => ({ outputs: [{ dims: r, dataType: t[0].dataType }], dispatchGroup: { x: m[0], y: m[1], z: m[2] }, programUniforms: b }), getShaderSource: x };
  };
});
var zd;
var Bd;
var Dd = V(() => {
  "use strict";
  J();
  re();
  oe();
  St();
  zd = (t, e4, r, n) => {
    let o = t.length > 2, i = o ? "value += b[output_channel];" : "", s = t[0].dims, u = t[1].dims, d = e4.format === "NHWC", c2 = d ? r[3] : r[1], p4 = c2 / e4.group, m = d && p4 >= 4 ? fe(c2) : 1, g = k4.size(r) / m, y = [{ type: 12, data: g }, { type: 12, data: e4.dilations }, { type: 12, data: [e4.strides[0], e4.strides[1]] }, { type: 12, data: [e4.pads[0], e4.pads[1]] }, { type: 12, data: p4 }];
    Ye(e4, y), y.push(...W(s, [u[0], u[1], u[2], u[3] / m]));
    let b = o ? ["rank", "rank", "rank"] : ["rank", "rank"];
    y.push(...W([r[0], r[1], r[2], r[3] / m]));
    let _ = (T) => {
      let x = U("output", t[0].dataType, r.length, m), $ = we(x.type.tensor), S = Qe(e4, x.type.value, $), I = O("x", t[0].dataType, s.length), E = O("w", t[1].dataType, u.length, m), A = [I, E];
      o && A.push(O("b", t[2].dataType, t[2].dims, m));
      let z = [{ name: "output_size", type: "u32" }, { name: "dilations", type: "u32", length: e4.dilations.length }, { name: "strides", type: "u32", length: 2 }, { name: "pads", type: "u32", length: 2 }, { name: "output_channels_per_group", type: "u32" }];
      Xe(e4, z);
      let v = d ? `
      for (var wHeight: u32 = 0u; wHeight < uniforms.w_shape[0]; wHeight++) {
        let xHeight = xRCCorner.x + wHeight * uniforms.dilations[0];

        if (xHeight < 0u || xHeight >= uniforms.x_shape[1]) {
          continue;
        }

        for (var wWidth: u32 = 0u; wWidth < uniforms.w_shape[1]; wWidth++) {
          let xWidth = xRCCorner.y + wWidth * uniforms.dilations[1];
          if (xWidth < 0u || xWidth >= uniforms.x_shape[2]) {
            continue;
          }

          for (var wInChannel: u32 = 0u; wInChannel < uniforms.w_shape[2]; wInChannel++) {
            let input_channel = in_channel_offset + wInChannel;
            let xVal = ${I.get("batch", "xHeight", "xWidth", "input_channel")};
            let wVal = ${E.get("wHeight", "wWidth", "wInChannel", "output_channel")};
            value += xVal * wVal;
          }
        }
      }
      ` : `
      for (var wInChannel: u32 = 0u; wInChannel < uniforms.w_shape[1]; wInChannel++) {
        let input_channel = in_channel_offset + wInChannel;
        for (var wHeight: u32 = 0u; wHeight < uniforms.w_shape[2]; wHeight++) {
          let xHeight = xRCCorner.x + wHeight * uniforms.dilations[0];

          if (xHeight < 0u || xHeight >= uniforms.x_shape[2]) {
            continue;
          }

          for (var wWidth: u32 = 0u; wWidth < uniforms.w_shape[3]; wWidth++) {
            let xWidth = xRCCorner.y + wWidth * uniforms.dilations[1];
            if (xWidth < 0u || xWidth >= uniforms.x_shape[3]) {
              continue;
            }

            let xVal = ${I.get("batch", "input_channel", "xHeight", "xWidth")};
            let wVal = ${E.get("output_channel", "wInChannel", "wHeight", "wWidth")};
            value += xVal * wVal;
          }
        }
      }
      `;
      return `
  ${T.registerUniforms(z).declareVariables(...A, x)}

  ${T.mainStart()}
    ${T.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}

    let outputIndices = ${x.offsetToIndices("global_idx")};
    let batch: u32 = outputIndices[0];
    let output_channel: u32 = outputIndices[${d ? 3 : 1}];
    let xRCCorner: vec2<u32> = vec2<u32>(outputIndices[${d ? 1 : 2}], outputIndices[${d ? 2 : 3}]) * uniforms.strides - uniforms.pads;
    let group_id: u32 = output_channel * ${m} / uniforms.output_channels_per_group;
    var in_channel_offset = group_id * uniforms.w_shape[${d ? 2 : 1}];

    var value: ${x.type.value} = ${x.type.value}(0);
    ${v}
    ${i}
    ${S}
    ${x.setByOffset("global_idx", "value")}
  }`;
    };
    return { name: "GroupedConv", shaderCache: { hint: `${e4.cacheKey}_${m}`, inputDependencies: b }, getRunData: () => ({ outputs: [{ dims: n ? n(r) : r, dataType: t[0].dataType }], dispatchGroup: { x: Math.ceil(g / 64) }, programUniforms: y }), getShaderSource: _ };
  }, Bd = (t, e4, r, n) => {
    let o = t.length > 2, i = fe(r[3]), s = fe(r[2]), u = k4.size(r) / i / s, d = [t[0].dims[0], t[0].dims[1], t[0].dims[2], t[0].dims[3] / i], c2 = [t[1].dims[0], t[1].dims[1], t[1].dims[2], t[1].dims[3] / i], p4 = [r[0], r[1], r[2], r[3] / i], m = [{ type: 12, data: u }, { type: 6, data: [e4.strides[0], e4.strides[1]] }, { type: 6, data: [e4.pads[0], e4.pads[1]] }];
    Ye(e4, m), m.push(...W(d, c2, p4));
    let g = (s - 1) * e4.strides[1] + c2[1], y = (b) => {
      let _ = U("output", t[0].dataType, p4.length, i), T = we(_.type.tensor), x = Qe(e4, _.type.value, T), $ = O("x", t[0].dataType, d.length, i), S = O("w", t[1].dataType, c2.length, i), I = [$, S];
      o && I.push(O("b", t[2].dataType, t[2].dims, i));
      let E = o ? "value += b[output_channel];" : "", A = [{ name: "output_size", type: "u32" }, { name: "strides", type: "i32", length: 2 }, { name: "pads", type: "i32", length: 2 }];
      return Xe(e4, A), `
  ${b.registerUniforms(A).declareVariables(...I, _)}
  ${b.mainStart()}
    ${b.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    let width0 = uniforms.output_shape[3];
    let output_channel = global_idx % width0;
    var index1 = global_idx / width0;
    let width1 = uniforms.output_shape[2] / ${s}u;
    let col = (index1 % width1) * ${s}u;
    index1 = index1 / width1;
    let row = index1 % uniforms.output_shape[1];
    let batch = index1 / uniforms.output_shape[1];

    let x_corner = vec2<i32>(i32(row), i32(col)) * uniforms.strides - uniforms.pads;

    var x_vals: array<${$.type.value}, ${g}>;
    var values: array<${_.type.value}, ${s}>;
    let input_channel = output_channel;
    // Use constant instead of uniform can give better performance for w's height/width.
    for (var w_height: u32 = 0u; w_height < ${c2[0]}; w_height++) {
      let x_height = x_corner.x + i32(w_height);
      if (x_height >= 0 && u32(x_height) < uniforms.x_shape[1]) {
        for (var i = 0; i < ${g}; i++) {
          let x_width = x_corner.y + i;
          if (x_width >= 0 && u32(x_width) < uniforms.x_shape[2]) {
            x_vals[i] = ${$.get("batch", "u32(x_height)", "u32(x_width)", "input_channel")};
          } else {
            x_vals[i] = ${$.type.value}(0);
          }
        }
        for (var w_width: u32 = 0u; w_width < ${c2[1]}; w_width++) {
          let w_val = ${S.get("w_height", "w_width", "0", "output_channel")};
          for (var i = 0u; i < ${s}u; i++) {
            values[i] = fma(x_vals[i * u32(uniforms.strides[1]) + w_width], w_val, values[i]);
          }
        }
      }
    }

    for (var i = 0u; i < ${s}u; i++) {
      var value = values[i];
      ${E}
      ${x}
      ${_.set("batch", "row", "col + i", "output_channel", "value")};
    }
  }`;
    };
    return { name: "GroupedConv-Vectorize", shaderCache: { hint: `${e4.cacheKey};${i};${s};${g};${c2[0]};${c2[1]}`, inputDependencies: o ? ["rank", "rank", "type"] : ["rank", "rank"] }, getRunData: () => ({ outputs: [{ dims: n ? n(r) : r, dataType: t[0].dataType }], dispatchGroup: { x: Math.ceil(u / 64) }, programUniforms: m }), getShaderSource: y };
  };
});
var Fh;
var xo;
var qh;
var So;
var To;
var Md;
var Kh;
var jh;
var Io;
var Rd = V(() => {
  "use strict";
  re();
  Cd();
  Od();
  sn();
  Dd();
  St();
  an();
  pt();
  Fh = (t, e4, r, n, o, i) => {
    let s = t[0], u = t.slice(i ? 1 : 2, i ? 3 : 4), d = u.length, c2 = e4[0], m = e4.slice(2).map((b, _) => b + (b - 1) * (r[_] - 1)), y = u.map((b, _) => b + n[_] + n[_ + d]).map((b, _) => Math.floor((b - m[_] + o[_]) / o[_]));
    return y.splice(0, 0, s), y.splice(i ? 3 : 1, 0, c2), y;
  }, xo = [2, 3, 1, 0], qh = (t, e4) => {
    if (!t || t.length !== 2 && t.length !== 3) throw new Error("Conv requires 2 or 3 inputs");
    if (t[0].dims.length > 5) throw new Error("greater than 5D is not supported");
    if (t[0].dims.length !== t[1].dims.length) throw new Error("filter does not have same dimension as input");
    let r = t[0].dims[e4.format === "NHWC" ? t[0].dims.length - 1 : 1], n = t[1].dims[1] * e4.group;
    if (r !== n) throw new Error("FILTER_IN_CHANNEL should be equal to DATA_CHANNEL");
    if (t.length === 3 && (t[2].dims.length !== 1 || t[1].dims[0] !== t[2].dims[0])) throw new Error("invalid bias");
    let o = t[0].dims.length - 2;
    if (e4.dilations.length !== o) throw new Error(`dilations should be ${o}D`);
    if (e4.strides.length !== o) throw new Error(`strides should be ${o}D`);
    if (e4.pads.length !== o * 2) throw new Error(`pads should be ${o * 2}D`);
    if (e4.kernelShape.length !== 0 && e4.kernelShape.length !== t[1].dims.length - 2) throw new Error("invalid kernel shape");
  }, So = (t, e4) => {
    let r = t.kernelShape.slice();
    r.length < e4[1].dims.length - 2 && r.push(...Array(e4[1].dims.length - 2 - r.length).fill(0));
    for (let i = 2; i < e4[1].dims.length; ++i) r[i - 2] === 0 && (r[i - 2] = e4[1].dims[i]);
    let n = t.pads.slice();
    zt.adjustPadsBasedOnAutoPad(e4[0].dims, t.strides, t.dilations, r, n, t.format === "NHWC", t.autoPad);
    let o = Object.assign({}, t);
    return Object.assign(o, { kernelShape: r, pads: n }), o;
  }, To = (t) => {
    let e4 = rn(t), r = t.format, n = ["NOTSET", "VALID", "SAME_UPPER", "SAME_LOWER"][t.auto_pad], o = t.dilations, i = t.group, s = t.kernel_shape, u = t.pads, d = t.strides, c2 = t.w_is_const();
    return { autoPad: n, format: r, dilations: o, group: i, kernelShape: s, pads: u, strides: d, wIsConst: c2, ...e4, cacheKey: `${t.format};${e4.activation};` };
  }, Md = (t, e4, r, n) => {
    let o = r.format === "NHWC", i = Fh(e4[0].dims, e4[1].dims, r.dilations, r.pads, r.strides, o);
    if (r.group !== 1) {
      let A = [e4[0]];
      if (o) {
        let v = t.kernelCustomData.wT ?? t.compute(Be(e4[1], xo), { inputs: [1], outputs: [r.wIsConst ? -2 : -1] })[0];
        r.wIsConst && !t.kernelCustomData.wT && (t.kernelCustomData.wT = v), A.push(v);
      } else A.push(e4[1]);
      e4.length === 3 && A.push(e4[2]), !t.adapterInfo.isArchitecture("ampere") && o && e4[1].dims[0] === r.group && e4[1].dims[1] === 1 && r.dilations[0] === 1 && r.dilations[1] === 1 ? t.compute(Bd(A, r, i, n), { inputs: A }) : t.compute(zd(A, r, i, n), { inputs: A });
      return;
    }
    let s = e4.length === 3, u = e4[0].dims[o ? 1 : 2], d = e4[0].dims[o ? 2 : 3], c2 = e4[0].dims[o ? 3 : 1], p4 = e4[1].dims[2], m = e4[1].dims[3], g = i[o ? 1 : 2], y = i[o ? 2 : 3], b = i[o ? 3 : 1], _ = o && p4 === u && m === d && r.pads[0] === 0 && r.pads[1] === 0;
    if (_ || p4 === 1 && m === 1 && r.dilations[0] === 1 && r.dilations[1] === 1 && r.strides[0] === 1 && r.strides[1] === 1 && r.pads[0] === 0 && r.pads[1] === 0) {
      let A = i[0], z, v, R, N = [];
      if (o) {
        let X = t.kernelCustomData.wT ?? t.compute(Be(e4[1], xo), { inputs: [1], outputs: [r.wIsConst ? -2 : -1] })[0];
        if (r.wIsConst && !t.kernelCustomData.wT && (t.kernelCustomData.wT = X), _) {
          let B = u * d * c2;
          z = e4[0].reshape([1, A, B]), v = X.reshape([1, B, b]), R = [1, A, b];
        } else z = e4[0].reshape([A, u * d, c2]), v = X.reshape([1, c2, b]), R = [A, g * y, b];
        N.push(z), N.push(v);
      } else z = e4[0].reshape([A, c2, u * d]), v = e4[1].reshape([1, b, c2]), R = [A, b, g * y], N.push(v), N.push(z);
      s && N.push(e4[2]);
      let F = R[2], q = N[0].dims[N[0].dims.length - 1];
      F < 8 && q < 8 ? t.compute(on(N, r, i, R, o, n), { inputs: N }) : t.compute(ar(N, r, i, R, o, n), { inputs: N });
      return;
    }
    let T = true, x = t.kernelCustomData.wT ?? t.compute(Be(e4[1], xo), { inputs: [1], outputs: [r.wIsConst ? -2 : -1] })[0];
    r.wIsConst && !t.kernelCustomData.wT && (t.kernelCustomData.wT = x);
    let $ = [e4[0], x];
    s && $.push(e4[2]);
    let S = o ? g * y : b, I = o ? b : g * y, E = p4 * m * c2;
    t.compute(Id($, r, i, S, I, E, s, T, n), { inputs: $ });
  }, Kh = (t, e4) => {
    let r = e4.format === "NHWC", n = [t.inputs[0].reshape(r ? [t.inputs[0].dims[0], 1, t.inputs[0].dims[1], t.inputs[0].dims[2]] : [t.inputs[0].dims[0], t.inputs[0].dims[1], 1, t.inputs[0].dims[2]]), t.inputs[1].reshape([t.inputs[1].dims[0], t.inputs[1].dims[1], 1, t.inputs[1].dims[2]])];
    t.inputs.length === 3 && n.push(t.inputs[2]);
    let o = [0, e4.pads[0], 0, e4.pads[1]], i = [1].concat(e4.strides), s = [1].concat(e4.dilations), u = [1].concat(e4.kernelShape), d = So({ ...e4, pads: o, strides: i, dilations: s, kernelShape: u }, n);
    Md(t, n, d, (c2) => r ? [c2[0], c2[2], c2[3]] : [c2[0], c2[1], c2[3]]);
  }, jh = (t, e4, r) => {
    let n = r.format === "NHWC" ? "channelsLast" : "channelsFirst", o = So(r, e4), i = r.autoPad === "NOTSET" ? r.pads : r.autoPad, s = kd(e4[0].dims, e4[1].dims, r.strides, r.dilations, i, false, n);
    t.compute(Pd(e4, o, s.outShape, [s.filterDepth, s.filterHeight, s.filterWidth], [s.padInfo.front, s.padInfo.top, s.padInfo.left], n));
  }, Io = (t, e4) => {
    if (qh(t.inputs, e4), t.inputs[0].dims.length === 3) Kh(t, e4);
    else if (t.inputs[0].dims.length === 5) jh(t, t.inputs, e4);
    else {
      let r = So(e4, t.inputs);
      Md(t, t.inputs, r);
    }
  };
});
var Ud;
var Nd = V(() => {
  "use strict";
  J();
  nt();
  re();
  oe();
  Ud = (t, e4, r) => {
    let n = t.length > 2, o = e4.outputShape, i = e4.format === "NHWC", s = e4.group, u = t[1].dims, d = u[2] / s, c2 = u[3], p4 = i ? fe(d) : 1, m = i && c2 === 1 && d >= 4, g = m ? Math.floor(d / 4) * 4 : Math.floor(d / p4) * p4, y = d - g, b = i ? fe(c2) : 1, _ = i ? c2 === 1 ? p4 : b : 1, T = k4.size(o) / b, x = [Math.ceil(T / 64), 1, 1];
    ie("verbose", () => `[conv2d_backprop_webgpu] dispatch = ${x}`);
    let $ = ["rank", "rank"], S = [e4.strides[0], e4.strides[1]], I = [e4.kernelShape[i ? 1 : 2], e4.kernelShape[i ? 2 : 3]], E = [e4.dilations[0], e4.dilations[1]], A = [I[0] + (e4.dilations[0] <= 1 ? 0 : (e4.kernelShape[i ? 1 : 2] - 1) * (e4.dilations[0] - 1)), I[1] + (e4.dilations[1] <= 1 ? 0 : (e4.kernelShape[i ? 2 : 3] - 1) * (e4.dilations[1] - 1))], z = [A[0] - 1 - Math.floor((e4.pads[0] + e4.pads[2]) / 2), A[1] - 1 - Math.floor((e4.pads[1] + e4.pads[3]) / 2)], v = [{ type: 12, data: T }, { type: 12, data: S }, { type: 12, data: I }, { type: 12, data: E }, { type: 12, data: A }, { type: 6, data: z }, { type: 12, data: g }, { type: 12, data: d }, { type: 12, data: c2 }, ...W(t[0].dims, t[1].dims)];
    n && (v.push(...W(t[2].dims)), $.push("rank")), v.push(...W(o));
    let R = (N) => {
      let F = [{ name: "output_size", type: "u32" }, { name: "strides", type: "u32", length: S.length }, { name: "filter_dims", type: "u32", length: I.length }, { name: "dilations", type: "u32", length: I.length }, { name: "effective_filter_dims", type: "u32", length: A.length }, { name: "pads", type: "i32", length: z.length }, { name: "input_channels_per_group_int", type: "u32" }, { name: "input_channels_per_group", type: "u32" }, { name: "output_channels_per_group", type: "u32" }], q = we(t[0].dataType), X = i ? 1 : 2, B = i ? 2 : 3, L = i ? 3 : 1, Q = O("W", t[1].dataType, t[1].dims.length, _), Y = O("Dy", t[0].dataType, t[0].dims.length, p4), Z = [Y, Q];
      n && Z.push(O("bias", t[2].dataType, [o[L]].length, b));
      let te = U("result", t[0].dataType, o.length, b), ae = () => {
        let ve = "";
        if (m) p4 === 4 ? ve += `
        let xValue = ${Y.getByOffset("x_offset")};
        let wValue = ${Q.getByOffset("w_offset")};
        dotProd = dotProd + dot(xValue, wValue);
        x_offset += 1u;
        w_offset += 1u;` : p4 === 2 ? ve += `
          dotProd = dotProd + dot(vec4<${q}>(${Y.getByOffset("x_offset")}, ${Y.getByOffset("x_offset + 1u")}), vec4<${q}>(${Q.getByOffset("w_offset")}, ${Q.getByOffset("w_offset + 1u")}));
          x_offset += 2u;
          w_offset += 2u;` : p4 === 1 && (ve += `
          dotProd = dotProd + dot(vec4<${q}>(${Y.getByOffset("x_offset")}, ${Y.getByOffset("x_offset + 1u")}, ${Y.getByOffset("x_offset + 2u")}, ${Y.getByOffset("x_offset + 3u")}), vec4<${q}>(${Q.getByOffset("w_offset")}, ${Q.getByOffset("w_offset + 1u")}, ${Q.getByOffset("w_offset + 2u")}, ${Q.getByOffset("w_offset + 3u")}));
          x_offset += 4u;
          w_offset += 4u;`);
        else if (ve += `
                  let xValue = ${i ? Y.getByOffset(`${Y.indicesToOffset(`${Y.type.indices}(batch, idyR, idyC, inputChannel)`)} / ${p4}`) : Y.get("batch", "inputChannel", "idyR", "idyC")};
        `, p4 === 1) ve += `
          let w_offset = ${Q.indicesToOffset(`${Q.type.indices}(u32(wRPerm), u32(wCPerm), inputChannel, wOutChannel)`)};
          let wValue = ${Q.getByOffset(`w_offset / ${_}`)};
          dotProd = dotProd + xValue * wValue;`;
        else for (let M3 = 0; M3 < p4; M3++) ve += `
            let wValue${M3} = ${Q.getByOffset(`${Q.indicesToOffset(`${Q.type.indices}(u32(wRPerm), u32(wCPerm), inputChannel + ${M3}, wOutChannel)`)} / ${_}`)};
            dotProd = dotProd + xValue[${M3}] * wValue${M3};`;
        return ve;
      }, le = () => {
        if (y === 0) return "";
        if (!m) throw new Error(`packInputAs4 ${m} is not true.`);
        let ve = "";
        if (p4 === 1) {
          ve += "dotProd = dotProd";
          for (let M3 = 0; M3 < y; M3++) ve += `
            + ${Y.getByOffset(`x_offset + ${M3}`)} * ${Q.getByOffset(`w_offset + ${M3}`)}`;
          ve += ";";
        } else if (p4 === 2) {
          if (y !== 2) throw new Error(`Invalid inputChannelsRemainder ${y}.`);
          ve += `
          let xValue = ${Y.getByOffset("x_offset")};
          let wValue = ${Q.getByOffset("w_offset")};
          dotProd = dotProd + dot(xValue, wValue);`;
        }
        return ve;
      }, Me = `
            let outputIndices = ${te.offsetToIndices(`global_idx * ${b}`)};
            let batch = ${te.indicesGet("outputIndices", 0)};
            let d1 = ${te.indicesGet("outputIndices", L)};
            let r = ${te.indicesGet("outputIndices", X)};
            let c = ${te.indicesGet("outputIndices", B)};
            let dyCorner = vec2<i32>(i32(r), i32(c)) - uniforms.pads;
            let dyRCorner = dyCorner.x;
            let dyCCorner = dyCorner.y;
            let groupId = d1 / uniforms.output_channels_per_group;
            let wOutChannel = d1 - groupId * uniforms.output_channels_per_group;
            // Convolve dy(?, ?, d2) with w(:, :, d1, d2) to compute dx(xR, xC, d1).
            // ? = to be determined. : = across all values in that axis.
            var dotProd = ${te.type.value}(0.0);
            var wR: u32 = 0;
            if (uniforms.dilations.x == 1) {
              // Minimum wR >= 0 that satisfies (dyRCorner + wR) % (uniforms.strides.x) == 0
              wR = u32(((dyRCorner + i32(uniforms.strides.x) - 1) / i32(uniforms.strides.x)) * i32(uniforms.strides.x) - dyRCorner);
            }
            for (; wR < uniforms.effective_filter_dims.x; wR = wR + 1) {
              if (wR % uniforms.dilations.x != 0) {
                continue;
              }
              let dyR = (${q}(dyRCorner) + ${q}(wR)) / ${q}(uniforms.strides[0]);
              let wRPerm = uniforms.filter_dims.x - 1 - wR / uniforms.dilations.x;
              if (dyR < 0.0 || dyR >= ${q}(uniforms.Dy_shape[${X}]) || fract(dyR) > 0.0 ||
                  wRPerm < 0) {
                continue;
              }
              let idyR: u32 = u32(dyR);
              var wC: u32 = 0;
              if (uniforms.dilations.y == 1) {
                // Minimum wC >= 0 that satisfies (dyCCorner + wC) % (uniforms.strides.y) == 0
                wC = u32(((dyCCorner + i32(uniforms.strides.y) - 1) / i32(uniforms.strides.y)) * i32(uniforms.strides.y) - dyCCorner);
              }
              for (; wC < uniforms.effective_filter_dims.y; wC = wC + 1) {
                if (wC % uniforms.dilations.y != 0) {
                  continue;
                }
                let dyC = (${q}(dyCCorner) + ${q}(wC)) / ${q}(uniforms.strides.y);
                let wCPerm = uniforms.filter_dims.y - 1 - wC / uniforms.dilations.y;
                if (dyC < 0.0 || dyC >= ${q}(uniforms.Dy_shape[${B}]) ||
                    fract(dyC) > 0.0 || wCPerm < 0) {
                  continue;
                }
                let idyC: u32 = u32(dyC);
                var inputChannel = groupId * uniforms.input_channels_per_group;
                ${m ? `
                var x_offset = ${Y.indicesToOffset(`${Y.type.indices}(batch, idyR, idyC, inputChannel)`)} / ${p4};
                var w_offset = ${Q.indicesToOffset(`${Q.type.indices}(wRPerm, wCPerm, inputChannel, wOutChannel)`)} / ${_};
                  ` : ""}
                for (var d2: u32 = 0; d2 < uniforms.input_channels_per_group_int; d2 = d2 + ${m ? 4 : p4}) {
                  ${ae()}
                  inputChannel = inputChannel + ${m ? 4 : p4};
                }
                ${le()}
                wC = wC + uniforms.strides.y - 1;
              }
              wR = wR + uniforms.strides[0] - 1;
            }
            let value = dotProd${n ? ` + bias[d1 / ${b}]` : ""};
            ${te.setByOffset("global_idx", "value")};
          `;
      return `
    ${N.registerUniforms(F).declareVariables(...Z, te)}
      ${N.mainStart()}
      ${N.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")};
    ${Me}}`;
    };
    return { name: "ConvTranspose2D", shaderCache: { hint: `${e4.cacheKey};${p4}${_}${b}${m}${y}`, inputDependencies: $ }, getRunData: () => ({ dispatchGroup: { x: x[0], y: x[1], z: x[2] }, outputs: [{ dims: r ? r(o) : o, dataType: t[0].dataType }], programUniforms: v }), getShaderSource: R };
  };
});
var Zh;
var Qh;
var Yh;
var Vd;
var Ld;
var Xh;
var Wd;
var Jh;
var Gd;
var Hd = V(() => {
  "use strict";
  Nd();
  St();
  pt();
  Zh = (t, e4, r, n, o, i) => (t - 1) * e4 + r + (n - 1) * o + 1 - i, Qh = (t, e4, r, n, o) => {
    let i = Math.floor(t / 2);
    e4 === "SAME_UPPER" ? (r[n] = i, r[o] = t - i) : e4 === "SAME_LOWER" && (r[n] = t - i, r[o] = i);
  }, Yh = (t, e4, r, n, o, i, s, u, d, c2) => {
    let p4 = t.length - 2, m = c2.length === 0;
    d.length < p4 && d.push(...Array(p4 - d.length).fill(0));
    let g = t[0], y = e4[u ? 3 : 1] * o;
    for (let b = 0, _ = t.length - p4 - (u ? 1 : 0); b < p4; ++b, ++_) {
      let T = t[_], x = m ? T * s[b] : c2[b], $ = Zh(T, s[b], i[b], e4[_], r[b], x);
      Qh($, n, i, b, b + p4), m && c2.push(s[b] * (T - 1) + d[b] + (e4[_] - 1) * r[b] + 1 - i[b] - i[b + p4]);
    }
    c2.splice(0, 0, g), c2.splice(u ? 3 : 1, 0, y);
  }, Vd = (t, e4) => {
    let r = t.kernelShape.slice();
    if (t.kernelShape.length === 0 || t.kernelShape.reduce((m, g) => m * g, 1) === 0) {
      r.length = 0;
      for (let m = 2; m < e4[1].dims.length; ++m) r.push(e4[1].dims[m]);
    }
    let n = t.format === "NHWC";
    r.splice(0, 0, e4[1].dims[0]), r.splice(n ? 3 : 1, 0, e4[1].dims[1]);
    let o = t.pads.slice(), i = t.outputShape.slice(), s = t.outputPadding.slice(), u = e4[0].dims, d = t.dilations.slice();
    if (d.reduce((m, g) => m + g, 0) === 0) {
      let m = e4[0].dims.length - 2;
      d = new Array(m).fill(1);
    }
    let c2 = t.strides.slice();
    if (c2.reduce((m, g) => m + g, 0) === 0) {
      let m = e4[0].dims.length - 2;
      c2 = new Array(m).fill(1);
    }
    Yh(u, r, d, t.autoPad, t.group, o, c2, n, s, i);
    let p4 = Object.assign({}, t);
    return Object.assign(p4, { kernelShape: r, pads: o, outputPadding: s, outputShape: i, dilations: d, strides: c2 }), p4;
  }, Ld = (t) => {
    let e4 = rn(t), r = t.format, n = ["NOTSET", "VALID", "SAME_UPPER", "SAME_LOWER"][typeof t.autoPad > "u" ? 0 : t.autoPad], o = t.dilations, i = t.group ?? 1, s = t.kernelShape, u = t.pads, d = t.strides, c2 = t.wIsConst(), p4 = t.outputPadding, m = t.outputShape;
    return { autoPad: n, format: r, dilations: o, group: i, kernelShape: s, outputPadding: p4, outputShape: m, pads: u, strides: d, wIsConst: c2, ...e4, cacheKey: `${t.format};${e4.activation};` };
  }, Xh = (t, e4) => {
    if (!t || t.length !== 2 && t.length !== 3) throw new Error("Conv requires 2 or 3 inputs");
    if (t[0].dims.length !== 4 && t[0].dims.length !== 3) throw new Error("currently only support 2-dimensional conv");
    if (t[0].dims.length !== t[1].dims.length) throw new Error("filter does not have same dimension as input");
    let r = t[0].dims[e4.format === "NHWC" ? t[0].dims.length - 1 : 1], n = t[1].dims[0];
    if (r !== n) throw new Error("FILTER_IN_CHANNEL should be equal to DATA_CHANNEL");
    let o = t[1].dims[1] * e4.group;
    if (t.length === 3 && (t[2].dims.length !== 1 || t[2].dims[0] !== o)) throw new Error("invalid bias");
    let i = t[0].dims.length - 2;
    if (e4.dilations.reduce((p4, m) => p4 + m, 0) > 0 && e4.dilations.length !== i) throw new Error(`dilations should be ${i}D`);
    if (e4.strides.reduce((p4, m) => p4 + m, 0) > 0 && e4.strides.length !== i) throw new Error(`strides should be ${i}D`);
    if (e4.pads.reduce((p4, m) => p4 + m, 0) > 0 && e4.pads.length !== i * 2) throw new Error(`pads should be ${i * 2}D`);
    if (e4.outputPadding.length !== i && e4.outputPadding.length !== 0) throw new Error(`output_padding should be ${i}D`);
    if (e4.kernelShape.reduce((p4, m) => p4 + m, 0) > 0 && e4.kernelShape.length !== 0 && e4.kernelShape.length !== t[1].dims.length - 2) throw new Error("invalid kernel shape");
    if (e4.outputShape.length !== 0 && e4.outputShape.length !== t[0].dims.length - 2) throw new Error("invalid output shape");
  }, Wd = (t, e4, r, n) => {
    let o = t.kernelCustomData.wT ?? t.compute(Be(e4[1], [2, 3, 0, 1]), { inputs: [1], outputs: [r.wIsConst ? -2 : -1] })[0];
    r.wIsConst && !t.kernelCustomData.wT && (t.kernelCustomData.wT = o);
    let i = [e4[0], o];
    e4.length === 3 && i.push(e4[2]), t.compute(Ud(i, r, n), { inputs: i });
  }, Jh = (t, e4) => {
    let r = e4.format === "NHWC", n = [t.inputs[0].reshape(r ? [t.inputs[0].dims[0], 1, t.inputs[0].dims[1], t.inputs[0].dims[2]] : [t.inputs[0].dims[0], t.inputs[0].dims[1], 1, t.inputs[0].dims[2]]), t.inputs[1].reshape([t.inputs[1].dims[0], t.inputs[1].dims[1], 1, t.inputs[1].dims[2]])];
    t.inputs.length === 3 && n.push(t.inputs[2]);
    let o = e4.kernelShape;
    (o.length === 0 || o[0] === 0) && (o = [t.inputs[1].dims[2]]);
    let i = e4.dilations;
    (i.length === 0 || i[0] === 0) && (i = [1]);
    let s = e4.strides;
    (s.length === 0 || s[0] === 0) && (s = [1]);
    let u = e4.pads;
    u.length === 0 && (u = [0, 0]), u = [0, u[0], 0, u[1]], s = [1].concat(s), i = [1].concat(i), o = [1].concat(o);
    let d = e4.outputPadding;
    d = [0].concat(d);
    let c2 = Vd({ ...e4, pads: u, strides: s, dilations: i, kernelShape: o, outputPadding: d }, n);
    Wd(t, n, c2, (p4) => r ? [p4[0], p4[2], p4[3]] : [p4[0], p4[1], p4[3]]);
  }, Gd = (t, e4) => {
    if (Xh(t.inputs, e4), t.inputs[0].dims.length === 3) Jh(t, e4);
    else {
      let r = Vd(e4, t.inputs);
      Wd(t, t.inputs, r);
    }
  };
});
var eg;
var Fd;
var qd;
var Kd = V(() => {
  "use strict";
  J();
  re();
  Ce();
  oe();
  eg = (t, e4, r, n) => {
    let o = k4.size(e4), i = e4.length, s = O("input", t, i), u = U("output", t, i), d = r.dataType === 6 ? r.getInt32Array()[0] : Number(r.getBigInt64Array()[0]), c2 = k4.normalizeAxis(d, i), p4 = (m) => {
      let g = ` i32(${s.indicesGet("inputIndices", "uniforms.axis")}) `, y = j("uniforms.input_shape", "uniforms.axis", i), b = n.reverse ? g + (n.exclusive ? " + 1" : "") : "0", _ = n.reverse ? y : g + (n.exclusive ? "" : " + 1");
      return `
                ${m.registerUniform("outputSize", "u32").registerUniform("axis", "u32").declareVariables(s, u)}
                ${m.mainStart()}
                  ${m.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
                  var inputIndices = ${u.offsetToIndices("global_idx")};
                  var sum = ${u.type.value}(0);
                  let first : i32 = ${b};
                  let last : i32 = ${_};
                  for (var i : i32 = first; i < last; i++) {
                    ${s.indicesSet("inputIndices", "uniforms.axis", "u32(i)")};
                    sum = sum + ${s.getByIndices("inputIndices")};
                  }
                  ${u.setByOffset("global_idx", "sum")};
                }`;
    };
    return { name: "CumSum", shaderCache: { hint: n.cacheKey, inputDependencies: ["rank"] }, getRunData: () => ({ outputs: [{ dims: e4, dataType: t }], dispatchGroup: { x: Math.ceil(o / 64) }, programUniforms: [{ type: 12, data: o }, { type: 12, data: c2 }, ...W(e4, e4)] }), getShaderSource: p4 };
  }, Fd = (t, e4) => {
    let r = t.inputs[0].dims, n = t.inputs[0].dataType, o = t.inputs[1];
    t.compute(eg(n, r, o, e4), { inputs: [0] });
  }, qd = (t) => {
    let e4 = t.exclusive === 1, r = t.reverse === 1;
    return ee({ exclusive: e4, reverse: r });
  };
});
var tg;
var rg;
var ng;
var jd;
var Zd;
var Qd = V(() => {
  "use strict";
  J();
  re();
  Ce();
  oe();
  tg = (t) => {
    if (!t || t.length !== 1) throw new Error("DepthToSpace requires 1 input.");
    if (t[0].dims.length !== 4) throw new Error("DepthToSpace requires 4D input.");
  }, rg = (t, e4, r, n) => {
    let o = [];
    o.push(`fn perm(i: ${n.type.indices}) -> ${r.type.indices} {
    var a: ${r.type.indices};`);
    for (let i = 0; i < e4; ++i) o.push(r.indicesSet("a", t[i], `i[${i}]`));
    return o.push("return a;}"), o.join(`
`);
  }, ng = (t, e4) => {
    let r, n, o, i, s, u, d = e4.format === "NHWC", c2 = e4.blocksize, p4 = e4.mode === "DCR";
    d ? ([r, n, o, i] = t.dims, s = p4 ? [r, n, o, c2, c2, i / c2 ** 2] : [r, n, o, i / c2 ** 2, c2, c2], u = p4 ? [0, 1, 3, 2, 4, 5] : [0, 1, 4, 2, 5, 3]) : ([r, n, o, i] = [t.dims[0], t.dims[2], t.dims[3], t.dims[1]], s = p4 ? [r, c2, c2, i / c2 ** 2, n, o] : [r, i / c2 ** 2, c2, c2, n, o], u = p4 ? [0, 3, 4, 1, 5, 2] : [0, 1, 4, 2, 5, 3]);
    let m = t.reshape(s), g = m.dims.length, y = t.dataType, b = O("a", y, g), _ = U("output", y, g), T = (x) => `
  ${x.registerUniform("output_size", "u32").declareVariables(b, _)}

  ${rg(u, g, b, _)}

  ${x.mainStart()}
    ${x.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}

    let indices = ${_.offsetToIndices("global_idx")};
    let aIndices = perm(indices);

    ${_.setByOffset("global_idx", b.getByIndices("aIndices"))}
  }`;
    return { name: "DepthToSpace", shaderCache: { hint: `${t.dims};${e4.blocksize};${e4.mode}`, inputDependencies: ["rank"] }, getRunData: (x) => {
      let $ = d ? [r, n * c2, o * c2, i / c2 ** 2] : [r, i / c2 ** 2, n * c2, o * c2], S = k4.size($), I = m.dims, E = k4.sortBasedOnPerm(I, u);
      return { outputs: [{ dims: $, dataType: x[0].dataType }], dispatchGroup: { x: Math.ceil(S / 64) }, programUniforms: [{ type: 12, data: S }, ...W(I, E)] };
    }, getShaderSource: T };
  }, jd = (t, e4) => {
    tg(t.inputs), t.compute(ng(t.inputs[0], e4));
  }, Zd = (t) => ee({ blocksize: t.blocksize, mode: t.mode, format: t.format });
});
var Co;
var dn;
var Yd;
var og;
var ig;
var Ao;
var Eo;
var Xd;
var ag;
var Jd;
var el;
var tl = V(() => {
  "use strict";
  J();
  re();
  Ce();
  oe();
  Co = "[a-zA-Z]|\\.\\.\\.", dn = "(" + Co + ")+", Yd = "^" + dn + "$", og = "(" + dn + ",)*" + dn, ig = "^" + og + "$", Ao = class {
    constructor(e4 = -1) {
      this.symbolToIndices = /* @__PURE__ */ new Map(), this.inputIndex = e4;
    }
    addSymbol(e4, r) {
      let n = this.symbolToIndices.get(e4);
      n === void 0 ? n = [r] : n.push(r), this.symbolToIndices.set(e4, n);
    }
  }, Eo = class {
    constructor(e4, r) {
      this.equation = r;
      this.hasEllipsis = false, this.symbolToInfo = /* @__PURE__ */ new Map(), this.lhs = new Array(), this.outputDims = [];
      let [n, o] = r.includes("->") ? r.split("->", 2) : [r, ""];
      if (!n.match(RegExp(ig))) throw new Error("Invalid LHS term");
      if (n.split(",").forEach((u, d) => {
        let c2 = e4[d].dims.slice();
        if (!u.match(RegExp(Yd))) throw new Error("Invalid LHS term");
        let p4 = this.processTerm(u, true, c2, d);
        this.lhs.push(p4);
      }), o === "") o += [...this.symbolToInfo.entries()].filter(([u, d]) => d.count === 1 || u === "...").map(([u]) => u).join("");
      else if (!o.match(RegExp(dn))) throw new Error("Invalid RHS");
      o.match(RegExp(Co, "g"))?.forEach((u) => {
        if (u === "...") this.outputDims = this.outputDims.concat(this.ellipsisDims);
        else {
          let d = this.symbolToInfo.get(u);
          if (d === void 0) throw new Error("Invalid RHS symbol");
          this.outputDims.push(d.dimValue);
        }
      }), this.rhs = this.processTerm(o, false, this.outputDims);
    }
    addSymbol(e4, r, n) {
      let o = this.symbolToInfo.get(e4);
      if (o !== void 0) {
        if (o.dimValue !== r && o.count !== 1) throw new Error("Dimension mismatch");
        o.count++, o.inputIndices.push(n);
      } else o = { count: 1, dimValue: r, inputIndices: [n] };
      this.symbolToInfo.set(e4, o);
    }
    processTerm(e4, r, n, o = -1) {
      let i = n.length, s = false, u = [], d = 0;
      if (!e4.match(RegExp(Yd)) && !r && e4 !== "") throw new Error("Invalid LHS term");
      let c2 = e4.match(RegExp(Co, "g")), p4 = new Ao(o);
      return c2?.forEach((m, g) => {
        if (m === "...") {
          if (s) throw new Error("Only one ellipsis is allowed per input term");
          s = true;
          let y = i - c2.length + 1;
          if (y < 0) throw new Error("Ellipsis out of bounds");
          if (u = n.slice(d, d + y), this.hasEllipsis) {
            if (this.ellipsisDims.length !== u.length || this.ellipsisDims.toString() !== u.toString()) throw new Error("Ellipsis dimensions mismatch");
          } else if (r) this.hasEllipsis = true, this.ellipsisDims = u;
          else throw new Error("Ellipsis must be specified in the LHS");
          for (let b = 0; b < u.length; b++) {
            let _ = String.fromCharCode(48 + b);
            p4.addSymbol(_, g + b), this.addSymbol(_, n[d++], o);
          }
        } else p4.addSymbol(m, g + (this.hasEllipsis ? this.ellipsisDims.length - 1 : 0)), this.addSymbol(m, n[d++], o);
      }), p4;
    }
  }, Xd = (t) => t + "_max", ag = (t, e4, r, n) => {
    let i = t.map((p4) => p4.length).map((p4, m) => O(`input${m}`, e4, p4)), s = k4.size(n), u = U("output", e4, n.length), d = [...r.symbolToInfo.keys()].filter((p4) => !r.rhs.symbolToIndices.has(p4)), c2 = (p4) => {
      let m = [], g = "var prod = 1.0;", y = "var sum = 0.0;", b = "sum += prod;", _ = [], T = [], x = [], $ = [], S = r.symbolToInfo.size === r.rhs.symbolToIndices.size;
      r.symbolToInfo.forEach((E, A) => {
        if (r.rhs.symbolToIndices.has(A)) {
          let z = r.rhs.symbolToIndices.get(A)?.[0];
          z !== void 0 && r.lhs.forEach((v, R) => {
            if (E.inputIndices.includes(R)) {
              let N = v.symbolToIndices.get(A);
              if (N === void 0) throw new Error("Invalid symbol error");
              N.forEach((F) => {
                m.push(`${i[R].indicesSet(`input${R}Indices`, F, u.indicesGet("outputIndices", z))}`);
              });
            }
          });
        } else r.lhs.forEach((z, v) => {
          if (E.inputIndices.includes(v)) {
            let R = z.symbolToIndices.get(A);
            if (R === void 0) throw new Error("Invalid symbol error");
            R.forEach((N) => {
              _.push(`${i[v].indicesSet(`input${v}Indices`, N, `${A}`)}`);
            }), $.push(`prod *= ${i[v].getByIndices(`input${v}Indices`)};`);
          }
        }), T.push(`for(var ${A}: u32 = 0; ${A} < uniforms.${Xd(A)}; ${A}++) {`), x.push("}");
      });
      let I = S ? [...m, `let sum = ${i.map((E, A) => E.getByIndices(`input${A}Indices`)).join(" * ")};`] : [...m, y, ...T, ..._, g, ...$, b, ...x];
      return `
            ${p4.registerUniforms(d.map((E) => ({ name: `${Xd(E)}`, type: "u32" }))).registerUniform("outputSize", "u32").declareVariables(...i, u)}

            ${p4.mainStart()}
            ${p4.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
            var outputIndices = ${u.offsetToIndices("global_idx")};
            ${i.map((E, A) => `var input${A}Indices: ${i[A].type.indices};`).join(`
`)}
            ${I.join(`
`)};
            ${u.setByOffset("global_idx", "sum")};
          }`;
    };
    return { name: "Einsum", shaderCache: { hint: r.equation, inputDependencies: t.map(() => "rank") }, getRunData: () => {
      let p4 = d.filter((g) => r.symbolToInfo.has(g)).map((g) => ({ type: 12, data: r.symbolToInfo.get(g)?.dimValue || 0 }));
      p4.push({ type: 12, data: s });
      let m = t.map((g, y) => [...W(g)]).reduce((g, y) => g.concat(y), p4);
      return m.push(...W(n)), { outputs: [{ dims: n, dataType: e4 }], dispatchGroup: { x: Math.ceil(s / 64) }, programUniforms: m };
    }, getShaderSource: c2 };
  }, Jd = (t, e4) => {
    let r = new Eo(t.inputs, e4.equation), n = r.outputDims, o = t.inputs.map((i, s) => i.dims);
    t.compute(ag(o, t.inputs[0].dataType, r, n));
  }, el = (t) => {
    let e4 = t.equation.replace(/\s+/g, "");
    return ee({ equation: e4 });
  };
});
var sg;
var rl;
var ug;
var dg;
var nl;
var ol = V(() => {
  "use strict";
  J();
  re();
  oe();
  sg = (t) => {
    if (!t || t.length !== 2) throw new Error("Expand requires 2 input.");
    let e4 = t[0].dims, r = Array.from(t[1].getBigInt64Array(), Number), n = r.length < e4.length ? 0 : r.length - e4.length, o = e4.length < r.length ? 0 : e4.length - r.length;
    for (; n < r.length && o < e4.length; ++n, ++o) if (r[n] !== e4[o] && r[n] !== 1 && e4[o] !== 1) throw new Error("Expand requires shape to be broadcastable to input");
  }, rl = (t, e4) => {
    let r = t.length - e4.length, n = [];
    for (let o = 0; o < r; ++o) n.push(t[o]);
    for (let o = 0; o < e4.length; ++o) n.push(e4[o] === 1 ? t[o + r] : e4[o]);
    return n;
  }, ug = (t, e4) => t.length > e4.length ? rl(t, e4) : rl(e4, t), dg = (t) => {
    let e4 = t[0].dims, r = Array.from(t[1].getBigInt64Array(), Number), n = ug(e4, r), o = t[0].dataType, i = o === 9 || k4.size(e4) === 1, s = o === 9 || e4.length > 0 && e4[e4.length - 1] % 4 === 0 ? 4 : 1, u = i || n.length > 0 && n[n.length - 1] % 4 === 0 ? 4 : 1, d = Math.ceil(k4.size(n) / u), c2 = (m) => {
      let g = O("input", o, e4.length, s), y = U("output", o, n.length, u), b;
      if (o === 9) {
        let _ = (T, x, $ = "") => `
          let outputIndices${x} = ${y.offsetToIndices(`outputOffset + ${x}u`)};
          let offset${x} = ${g.broadcastedIndicesToOffset(`outputIndices${x}`, y)};
          let index${x} = offset${x} / 4u;
          let component${x} = offset${x} % 4u;
          ${T}[${x}] = ${$}(${g.getByOffset(`index${x}`)}[component${x}]);
        `;
        b = `
        let outputOffset = global_idx * ${u};
        var data = vec4<u32>(0);
        ${_("data", 0, "u32")}
        ${_("data", 1, "u32")}
        ${_("data", 2, "u32")}
        ${_("data", 3, "u32")}
        ${y.setByOffset("global_idx", "data")}
      }`;
      } else b = `
        let outputIndices = ${y.offsetToIndices(`global_idx * ${u}`)};
        let inputOffset = ${g.broadcastedIndicesToOffset("outputIndices", y)};
        let data = ${y.type.value}(${g.getByOffset(`inputOffset / ${s}`)});
        ${y.setByOffset("global_idx", "data")}
      }`;
      return `
    ${m.registerUniform("vec_size", "u32").declareVariables(g, y)}
    ${m.mainStart()}
    ${m.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.vec_size")}
    ${b}`;
    }, p4 = [{ type: 12, data: d }, ...W(e4, n)];
    return { name: "Expand", shaderCache: { hint: `${n.length};${s}${u}`, inputDependencies: ["rank"] }, getShaderSource: c2, getRunData: () => ({ outputs: [{ dims: n, dataType: t[0].dataType }], dispatchGroup: { x: Math.ceil(d / 64) }, programUniforms: p4 }) };
  }, nl = (t) => {
    sg(t.inputs), t.compute(dg(t.inputs), { inputs: [0] });
  };
});
var lg;
var il;
var al = V(() => {
  "use strict";
  J();
  re();
  oe();
  tn();
  lg = (t) => {
    let e4 = t[0].dataType, r = k4.size(t[0].dims), n = k4.size(t[1].dims), o = n % 4 === 0, i = (s) => {
      let u = O("x", e4, [1], 4), d = O("bias", e4, [1], 4), c2 = U("y", e4, [1], 4), p4 = [{ name: "output_vec_size", type: "u32" }, { name: "bias_size", type: "u32" }], m = (y) => `
      let bias${y}_offset: u32 = (global_idx * 4 + ${y}) % uniforms.bias_size;
      let bias${y} = ${d.getByOffset(`bias${y}_offset / 4`)}[bias${y}_offset % 4];`, g = o ? `
      let bias = ${d.getByOffset("global_idx % (uniforms.bias_size / 4)")};` : `${m(0)}${m(1)}${m(2)}${m(3)}
      let bias = ${u.type.value}(bias0, bias1, bias2, bias3);`;
      return `${s.registerUniforms(p4).declareVariables(u, d, c2)}

    ${_o(ze(e4))}

    ${s.mainStart(Bt)}
      ${s.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_vec_size")}

      let x = ${u.getByOffset("global_idx")};
      ${g}
      let x_in = x + bias;
      ${c2.setByOffset("global_idx", wo("x_in"))}
    }`;
    };
    return { name: "FastGeluWithBias", shaderCache: { hint: `${o}`, inputDependencies: ["type", "type"] }, getShaderSource: i, getRunData: (s) => ({ outputs: [{ dims: s[0].dims, dataType: s[0].dataType }], programUniforms: [{ type: 12, data: Math.ceil(r / 4) }, { type: 12, data: n }], dispatchGroup: { x: Math.ceil(r / Bt / 4) } }) };
  }, il = (t) => {
    t.inputs.length < 2 || k4.size(t.inputs[1].dims) === 0 ? td(t) : t.compute(lg(t.inputs));
  };
});
var cg;
var pg;
var sl;
var ul;
var dl = V(() => {
  "use strict";
  J();
  re();
  Ce();
  oe();
  cg = (t) => {
    if (!t || t.length !== 2) throw new Error("Gather requires 2 inputs.");
  }, pg = (t, e4) => {
    let r = t[0].dims, n = t[1].dims, o = r.length, i = k4.normalizeAxis(e4.axis, o), s = r.slice(0);
    s.splice(i, 1, ...n);
    let u = r[i], d = t[0].dataType === 9 ? 4 : 1, c2 = Math.ceil(k4.size(s) / d), p4 = [{ type: 12, data: c2 }, { type: 6, data: u }, { type: 12, data: i }, ...W(t[0].dims, t[1].dims, s)], m = (g) => {
      let y = O("data", t[0].dataType, t[0].dims.length, d), b = O("inputIndices", t[1].dataType, t[1].dims.length), _ = U("output", t[0].dataType, s.length, d), T = ($) => {
        let S = n.length, I = `var indicesIndices${$}  = ${b.type.indices}(0);`;
        for (let E = 0; E < S; E++) I += `${S > 1 ? `indicesIndices${$}[${E}]` : `indicesIndices${$}`} = ${s.length > 1 ? `outputIndices${$}[uniforms.axis + ${E}]` : `outputIndices${$}`};`;
        I += `
          var idx${$} = ${b.getByIndices(`indicesIndices${$}`)};
          if (idx${$} < 0) {
            idx${$} = idx${$} + uniforms.axisDimLimit;
          }
          var dataIndices${$} : ${y.type.indices};
        `;
        for (let E = 0, A = 0; E < o; E++) E === i ? (I += `${o > 1 ? `dataIndices${$}[${E}]` : `dataIndices${$}`} = u32(idx${$});`, A += S) : (I += `${o > 1 ? `dataIndices${$}[${E}]` : `dataIndices${$}`} = ${s.length > 1 ? `outputIndices${$}[${A}]` : `outputIndices${$}`};`, A++);
        return I;
      }, x;
      if (t[0].dataType === 9) {
        let $ = (S, I, E = "") => `
          let outputIndices${I} = ${_.offsetToIndices(`outputOffset + ${I}u`)};
          ${T(I)};
          let offset${I} = ${y.indicesToOffset(`dataIndices${I}`)};
          let index${I} = offset${I} / 4u;
          let component${I} = offset${I} % 4u;
          ${S}[${I}] = ${E}(${y.getByOffset(`index${I}`)}[component${I}]);
        `;
        x = `
        let outputOffset = global_idx * ${d};
        var value = vec4<u32>(0);
        ${$("value", 0, "u32")}
        ${$("value", 1, "u32")}
        ${$("value", 2, "u32")}
        ${$("value", 3, "u32")}
        ${_.setByOffset("global_idx", "value")}
      `;
      } else x = `
      let outputIndices = ${_.offsetToIndices("global_idx")};
      ${T("")};
      let value = ${y.getByIndices("dataIndices")};
      ${_.setByOffset("global_idx", "value")};
      `;
      return `
      ${g.registerUniform("outputSize", "u32").registerUniform("axisDimLimit", "i32").registerUniform("axis", "u32").declareVariables(y, b, _)}
      ${g.mainStart()}
        ${g.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
        ${x}
      }`;
    };
    return { name: "Gather", shaderCache: { hint: e4.cacheKey, inputDependencies: ["rank", "rank"] }, getRunData: () => ({ outputs: [{ dims: s, dataType: t[0].dataType }], dispatchGroup: { x: Math.ceil(c2 / 64) }, programUniforms: p4 }), getShaderSource: m };
  }, sl = (t) => ee({ axis: t.axis }), ul = (t, e4) => {
    let r = t.inputs;
    cg(r), t.compute(pg(t.inputs, e4));
  };
});
var mg;
var ll;
var cl;
var pl = V(() => {
  "use strict";
  J();
  re();
  oe();
  mg = (t, e4, r, n, o, i, s, u, d) => {
    let c2 = [{ type: 12, data: i }, { type: 12, data: n }, { type: 12, data: o }, { type: 12, data: r }, { type: 12, data: s }, { type: 12, data: u }, { type: 12, data: d }], p4 = [i];
    c2.push(...W(e4.dims, p4));
    let m = (g) => {
      let y = O("indices_data", e4.dataType, e4.dims.length), b = U("input_slice_offsets_data", 12, 1, 1), _ = [y, b], T = [{ name: "output_size", type: "u32" }, { name: "batch_dims", type: "u32" }, { name: "input_dims", type: "u32", length: o.length }, { name: "sizes_from_slice_dims_data", type: "u32", length: r.length }, { name: "num_slices_per_batch", type: "u32" }, { name: "input_batch_stride", type: "u32" }, { name: "num_slice_dims", type: "u32" }];
      return `
  ${g.registerUniforms(T).declareVariables(..._)}
  ${g.mainStart()}
    ${g.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    let batch_idx = global_idx / uniforms.num_slices_per_batch;
    let base_offset = batch_idx * uniforms.input_batch_stride;

    let slice_indices_base_offset = global_idx * uniforms.num_slice_dims;
    var relative_slice_offset = 0;
    for (var dim_idx = 0u; dim_idx < uniforms.num_slice_dims; dim_idx ++) {
      var index = i32(indices_data[dim_idx + slice_indices_base_offset].x);
      let input_dim_idx = uniforms.batch_dims + dim_idx;
      if (index < 0) {
        ${o.length === 1 ? "index += i32(uniforms.input_dims);" : "index += i32(uniforms.input_dims[input_dim_idx]);"}
      }
      ${r.length === 1 ? "relative_slice_offset += index * i32(uniforms.sizes_from_slice_dims_data);" : "relative_slice_offset += index * i32(uniforms.sizes_from_slice_dims_data[dim_idx]);"}
    }

    input_slice_offsets_data[global_idx] =  base_offset + u32(relative_slice_offset);
  }`;
    };
    return t.compute({ name: "computeSliceOffsets", shaderCache: { hint: `${o.length}_${r.length}`, inputDependencies: ["rank"] }, getRunData: () => ({ outputs: [{ dims: p4, dataType: t.inputs[1].dataType }], dispatchGroup: { x: Math.ceil(i / 64) }, programUniforms: c2 }), getShaderSource: m }, { inputs: [e4], outputs: [-1] })[0];
  }, ll = (t, e4) => {
    let r = t.inputs, n = r[0].dims, o = r[0].dataType, i = r[1].dims, s = i[i.length - 1], u = k4.sizeToDimension(i, i.length - 1), d = k4.sizeFromDimension(n, e4.batchDims + s), c2 = k4.sizeToDimension(n, e4.batchDims), p4 = k4.sizeFromDimension(n, e4.batchDims), m = u / c2, g = new Array(s), y = d;
    for (let I = 0; I < s; ++I) g[s - 1 - I] = y, y *= n[e4.batchDims + s - 1 - I];
    let b = mg(t, r[1], g, e4.batchDims, n, u, m, p4, s), _ = e4.batchDims + s;
    if (_ > n.length) throw new Error("last dimension of indices must not be larger than rank of input tensor");
    let T = i.slice(0, -1).concat(n.slice(_)), x = k4.size(T), $ = [{ type: 12, data: x }, { type: 12, data: d }, ...W(r[0].dims, b.dims, T)], S = (I) => {
      let E = O("data", r[0].dataType, r[0].dims.length), A = O("slice_offsets", 12, b.dims.length), z = U("output", r[0].dataType, T.length);
      return `
          ${I.registerUniform("output_size", "u32").registerUniform("slice_size", "u32").declareVariables(E, A, z)}
            ${I.mainStart()}
            ${I.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
          let slice_offset = slice_offsets[global_idx / uniforms.slice_size];
          output[global_idx] = data[u32(slice_offset) + global_idx % uniforms.slice_size];
        }`;
    };
    t.compute({ name: "GatherND", shaderCache: { hint: e4.cacheKey, inputDependencies: ["rank", "rank"] }, getRunData: () => ({ outputs: [{ dims: T, dataType: o }], dispatchGroup: { x: Math.ceil(x / 64) }, programUniforms: $ }), getShaderSource: S }, { inputs: [r[0], b] });
  }, cl = (t) => ({ batchDims: t.batch_dims, cacheKey: "" });
});
var fg;
var hg;
var ml;
var fl;
var hl = V(() => {
  "use strict";
  J();
  re();
  Ce();
  oe();
  fg = (t, e4) => {
    if (t.length < 3 || t.length > 4) throw new Error("GatherBlockQuantized requires 3 or 4 inputs.");
    let r = k4.normalizeAxis(e4.quantizeAxis, t[0].dims.length), n = e4.blockSize, o = t[0], i = t[2], s = t.length === 4 ? t[3] : void 0;
    if (i.dims.length !== o.dims.length || !o.dims.map((u, d) => d === r ? Math.ceil(u / n) === i.dims[d] : u === i.dims[d]).reduce((u, d) => u && d, true)) throw new Error("Scales must have the same rank as the input tensor and the dims should match except on gatherAxis.");
    if (s) {
      if (s.dataType !== o.dataType) throw new Error("Zero point must have the same data type as the input tensor.");
      if (s.dims.length !== i.dims.length || !s.dims.map((u, d) => u === i.dims[d]).reduce((u, d) => u && d, true)) throw new Error("Zero point must have the same rank as the input tensor and the dims should match except on quantizeAxis.");
    }
  }, hg = (t, e4) => {
    let r = t[0].dims, n = t[1].dims, o = r.length, i = k4.normalizeAxis(e4.gatherAxis, o), s = k4.normalizeAxis(e4.quantizeAxis, o), u = r.slice(0);
    u.splice(i, 1, ...n);
    let d = k4.size(u), c2 = t[2].dataType, m = t[0].dataType === 22, g = [{ type: 12, data: d }, { type: 12, data: s }, { type: 12, data: i }, { type: 12, data: e4.blockSize }, ...W(...t.map((b, _) => b.dims), u)], y = (b) => {
      let _ = O("data", t[0].dataType, t[0].dims.length), T = O("inputIndices", t[1].dataType, t[1].dims.length), x = O("scales", t[2].dataType, t[2].dims.length), $ = t.length > 3 ? O("zeroPoint", t[3].dataType, t[3].dims.length) : void 0, S = U("output", c2, u.length), I = [_, T, x];
      $ && I.push($);
      let E = [{ name: "output_size", type: "u32" }, { name: "quantize_axis", type: "u32" }, { name: "gather_axis", type: "u32" }, { name: "block_size", type: "u32" }];
      return `
        ${b.registerUniforms(E).declareVariables(...I, S)}
        ${b.mainStart()}
        let output_indices = ${S.offsetToIndices("global_idx")};
        var indices_indices = ${T.type.indices}(0);
        ${n.length > 1 ? `
          for (var i: u32 = 0; i < ${n.length}; i++) {
            let index = ${S.indicesGet("output_indices", "uniforms.gather_axis + i")};
            ${T.indicesSet("indices_indices", "i", "index")};
          }` : `indices_indices = ${S.indicesGet("output_indices", "uniforms.gather_axis")};`};
        var data_indices = ${_.type.indices}(0);
        for (var i: u32 = 0; i < uniforms.gather_axis; i++) {
          let index = ${S.indicesGet("output_indices", "i")};
          ${_.indicesSet("data_indices", "i", "index")};
        }
        var index_from_indices = ${T.getByIndices("indices_indices")};
        if (index_from_indices < 0) {
          index_from_indices += ${r[i]};
        }
        ${_.indicesSet("data_indices", "uniforms.gather_axis", "u32(index_from_indices)")};
        for (var i = uniforms.gather_axis + 1; i < ${u.length}; i++) {
          let index = ${S.indicesGet("output_indices", `i + ${n.length} - 1`)};
          ${_.indicesSet("data_indices", "i", "index")};
        }
        let data_offset = ${_.indicesToOffset("data_indices")};
        let data_index = data_offset % 8;
        // Convert 4-bit packed data to 8-bit packed data.
        let packed_4bit_quantized_data = ${_.getByOffset("data_offset / 8")};
        let packed_8bit_quantized_data = (packed_4bit_quantized_data >> (4 * (data_index % 2))) & 0x0f0f0f0f;
        let quantized_data_vec = ${m ? "unpack4xI8" : "unpack4xU8"}(u32(packed_8bit_quantized_data));
        let quantized_data = quantized_data_vec[data_index / 2];
        var scale_indices = data_indices;
        let quantize_axis_index = ${x.indicesGet("data_indices", "uniforms.quantize_axis")} / uniforms.block_size;
        ${x.indicesSet("scale_indices", "uniforms.quantize_axis", "quantize_axis_index")};
        var scale = ${x.getByIndices("scale_indices")};
        ${$ ? `
              let zero_point_indices = scale_indices;
              let zero_point_offset = ${$.indicesToOffset("zero_point_indices")};
              let zero_point_index = zero_point_offset % 8;
              let packed_4bit_zero_points = ${$.getByOffset("zero_point_offset / 8")};
              let packed_8bit_zero_points = (packed_4bit_zero_points >> (4 * (zero_point_index % 2))) & 0x0f0f0f0f;
              let zero_point_vec = ${m ? "unpack4xI8" : "unpack4xU8"}(u32(packed_8bit_zero_points));
              let zero_point = zero_point_vec[zero_point_index / 2];` : "var zero_point = 0"};
        let dequantized_data = ${ze(c2)}(quantized_data - zero_point) * scale;
        ${S.setByOffset("global_idx", "dequantized_data")};
    }`;
    };
    return { name: "GatherBlockQuantized", shaderCache: { hint: `${e4.cacheKey};${t.filter((b, _) => _ !== 1).map((b) => b.dims.join("_")).join(";")}`, inputDependencies: Array.from({ length: t.length }, (b, _) => "rank") }, getRunData: () => ({ outputs: [{ dims: u, dataType: c2 }], dispatchGroup: { x: Math.ceil(d / 64) }, programUniforms: g }), getShaderSource: y };
  }, ml = (t, e4) => {
    let r = t.inputs;
    fg(r, e4), t.compute(hg(t.inputs, e4));
  }, fl = (t) => ee({ blockSize: t.blockSize, gatherAxis: t.gatherAxis, quantizeAxis: t.quantizeAxis });
});
var gg;
var bg;
var gl;
var bl;
var yl = V(() => {
  "use strict";
  J();
  re();
  Ce();
  oe();
  gg = (t) => {
    if (!t || t.length !== 2) throw new Error("GatherElements requires 2 inputs.");
    if (t[0].dims.length < 1) throw new Error("GatherElements requires that the data input be rank >= 1.");
    if (t[0].dims.length !== t[1].dims.length) throw new Error(`GatherElements requires that the data input and
                     indices input tensors be of same rank.`);
  }, bg = (t, e4) => {
    let r = t[0].dims, n = t[0].dataType, o = r.length, i = t[1].dims, s = t[1].dataType, u = k4.normalizeAxis(e4.axis, o), d = r[u], c2 = i.slice(0), p4 = k4.size(c2), m = O("input", n, o), g = O("indicesInput", s, i.length), y = U("output", n, c2.length), b = [{ type: 12, data: p4 }, { type: 6, data: d }, { type: 12, data: u }];
    return b.push(...W(r, i, c2)), { name: "GatherElements", shaderCache: { inputDependencies: ["rank", "rank"] }, getRunData: () => ({ outputs: [{ dims: c2, dataType: t[0].dataType }], dispatchGroup: { x: Math.ceil(p4 / 64) }, programUniforms: b }), getShaderSource: (x) => `
      ${x.registerUniform("outputSize", "u32").registerUniform("axisDimLimit", "i32").registerUniform("axis", "u32").declareVariables(m, g, y)}
      ${x.mainStart()}
      ${x.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}

      let outputIndices = ${y.offsetToIndices("global_idx")};

      var idx = ${g.getByOffset("global_idx")};
      if (idx < 0) {
        idx = idx + uniforms.axisDimLimit;
      }
      var inputIndices = ${m.type.indices}(outputIndices);
      ${m.indicesSet("inputIndices", "uniforms.axis", "u32(idx)")};
      let value = ${m.getByIndices("inputIndices")};

      ${y.setByOffset("global_idx", "value")};
  }` };
  }, gl = (t) => ee({ axis: t.axis }), bl = (t, e4) => {
    let r = t.inputs;
    gg(r), t.compute(bg(t.inputs, e4));
  };
});
var yg;
var _g;
var _l;
var wl;
var vl = V(() => {
  "use strict";
  J();
  re();
  oe();
  yg = (t) => {
    if (!t) throw new Error("Input is missing");
    if (t.length < 2 || t.length > 3) throw new Error("Invaid input number.");
    if (t.length === 3 && t[2].dims.length > 2) throw new Error("Invalid input shape of C");
    if (t[0].dataType !== t[1].dataType || t.length === 3 && t[0].dataType !== t[2].dataType) throw new Error("Input types are mismatched");
  }, _g = (t, e4) => {
    let r = t[0].dims.slice(), n = t[1].dims.slice(), [o, i, s] = Wr.getShapeOfGemmResult(r, e4.transA, n, e4.transB, t.length === 3 ? t[2].dims : void 0), u = [o, i];
    if (!u) throw new Error("Can't use gemm on the given tensors");
    let d = 16, c2 = Math.ceil(i / d), p4 = Math.ceil(o / d), m = true, g = k4.size(u), y = [{ type: 12, data: m ? c2 : g }, { type: 12, data: o }, { type: 12, data: i }, { type: 12, data: s }, { type: 1, data: e4.alpha }, { type: 1, data: e4.beta }], b = ["type", "type"];
    t.length === 3 && (y.push(...W(t[2].dims)), b.push("rank")), y.push(...W(u));
    let _ = (x) => {
      let $ = "";
      e4.transA && e4.transB ? $ = "value += a[k * uniforms.M + m] * b[n * uniforms.K + k];" : e4.transA && !e4.transB ? $ = "value += a[k * uniforms.M + m] * b[k * uniforms.N + n];" : !e4.transA && e4.transB ? $ = "value += a[m * uniforms.K + k] * b[n * uniforms.K + k];" : !e4.transA && !e4.transB && ($ = "value += a[m * uniforms.K + k] * b[k * uniforms.N + n];");
      let S = e4.alpha === 1 ? "" : "value *= uniforms.alpha;", I = O("a", t[0].dataType, t[0].dims), E = O("b", t[1].dataType, t[1].dims), A = I.type.value, z = null, v = [I, E];
      t.length === 3 && (z = O("c", t[2].dataType, t[2].dims.length), v.push(z));
      let R = U("output", t[0].dataType, u.length);
      v.push(R);
      let N = [{ name: "output_size", type: "u32" }, { name: "M", type: "u32" }, { name: "N", type: "u32" }, { name: "K", type: "u32" }, { name: "alpha", type: "f32" }, { name: "beta", type: "f32" }];
      return `
  ${x.registerUniforms(N).declareVariables(...v)}

  ${x.mainStart()}
    ${x.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}

    let m = global_idx / uniforms.N;
    let n = global_idx % uniforms.N;

    var value = ${A}(0);
    for (var k: u32 = 0u; k < uniforms.K; k++) {
      ${$}
    }

    ${S}
    ${z != null ? `let cOffset = ${z.broadcastedIndicesToOffset("vec2(m, n)", R)}; value += ${A}(uniforms.beta) * ${z.getByOffset("cOffset")};` : ""}
    output[global_idx] = value;
  }`;
    }, T = (x) => {
      let $ = O("a", t[0].dataType, t[0].dims), S = O("b", t[1].dataType, t[1].dims), I = null, E = [$, S];
      t.length === 3 && (I = O("c", t[2].dataType, t[2].dims.length), E.push(I));
      let A = U("output", t[0].dataType, u.length);
      E.push(A);
      let z = [{ name: "num_tile_n", type: "u32" }, { name: "M", type: "u32" }, { name: "N", type: "u32" }, { name: "K", type: "u32" }, { name: "alpha", type: "f32" }, { name: "beta", type: "f32" }], v = "", R = "";
      e4.transA && e4.transB ? (R = `
      var col = tile_row_start + local_id.x;
      var row = k_start + local_id.y;
      if (col < uniforms.M && row < uniforms.K) {
        tile_a[local_id.y][local_id.x] = a[row * uniforms.M + col];
      } else {
        tile_a[local_id.y][local_id.x] = ${$.type.value}(0);
      }

      col = k_start + local_id.x;
      row = tile_col_start + local_id.y;
      if (col < uniforms.K && row < uniforms.N) {
        tile_b[local_id.y][local_id.x] = b[row * uniforms.K + col];
      } else {
        tile_b[local_id.y][local_id.x] = ${S.type.value}(0);
      }
      `, v = "value += tile_a[k][local_id.y] * tile_b[local_id.x][k];") : e4.transA && !e4.transB ? (R = `
      var col = tile_row_start + local_id.x;
      var row = k_start + local_id.y;
      if (col < uniforms.M && row < uniforms.K) {
        tile_a[local_id.y][local_id.x] = a[row * uniforms.M + col];
      } else {
        tile_a[local_id.y][local_id.x] = ${$.type.value}(0);
      }

      col = tile_col_start + local_id.x;
      row = k_start + local_id.y;
      if (col < uniforms.N && row < uniforms.K) {
        tile_b[local_id.y][local_id.x] = b[row * uniforms.N + col];
      } else {
        tile_b[local_id.y][local_id.x] = ${S.type.value}(0);
      }
      `, v = "value += tile_a[k][local_id.y] * tile_b[k][local_id.x];") : !e4.transA && e4.transB ? (R = `
      var col = k_start + local_id.x;
      var row = tile_row_start + local_id.y;
      if (col < uniforms.K && row < uniforms.M) {
        tile_a[local_id.y][local_id.x] = a[row * uniforms.K + col];
      } else {
        tile_a[local_id.y][local_id.x] = ${$.type.value}(0);
      }

      col = k_start + local_id.x;
      row = tile_col_start + local_id.y;
      if (col < uniforms.K && row < uniforms.N) {
        tile_b[local_id.y][local_id.x] = b[row * uniforms.K + col];
      } else {
        tile_b[local_id.y][local_id.x] = ${S.type.value}(0);
      }
      `, v = "value += tile_a[local_id.y][k] * tile_b[local_id.x][k];") : !e4.transA && !e4.transB && (R = `
      var col = k_start + local_id.x;
      var row = tile_row_start + local_id.y;
      if (col < uniforms.K && row < uniforms.M) {
        tile_a[local_id.y][local_id.x] = a[row * uniforms.K + col];
      } else {
        tile_a[local_id.y][local_id.x] = ${$.type.value}(0);
      }

      col = tile_col_start + local_id.x;
      row = k_start + local_id.y;
      if (col < uniforms.N && row < uniforms.K) {
        tile_b[local_id.y][local_id.x] = b[row * uniforms.N + col];
      } else {
        tile_b[local_id.y][local_id.x] = ${S.type.value}(0);
      }
      `, v = "value += tile_a[local_id.y][k] * tile_b[k][local_id.x];");
      let N = e4.alpha === 1 ? "" : "value *= uniforms.alpha;";
      return `
  ${x.registerUniforms(z).declareVariables(...E)}
  var<workgroup> tile_a: array<array<${$.type.storage}, ${d}>, ${d}>;
  var<workgroup> tile_b: array<array<${S.type.storage}, ${d}>, ${d}>;
  ${x.mainStart([d, d, 1])}
    let tile_col_start = (workgroup_index % uniforms.num_tile_n) * ${d};
    let tile_row_start = (workgroup_index / uniforms.num_tile_n) * ${d};
    let num_tiles = (uniforms.K - 1) / ${d} + 1;
    var k_start = 0u;
    var value = ${A.type.value}(0);
    for (var t: u32 = 0u; t < num_tiles; t++) {
      ${R}
      k_start = k_start + ${d};
      workgroupBarrier();

      for (var k: u32 = 0u; k < ${d}; k++) {
        ${v}
      }
      workgroupBarrier();
    }

    ${N}
    let m = tile_row_start + local_id.y;
    let n = tile_col_start + local_id.x;
    ${I != null ? `let cOffset = ${I.broadcastedIndicesToOffset("vec2(m, n)", A)}; value += ${A.type.value}(uniforms.beta) * ${I.getByOffset("cOffset")};` : ""}
    if (m < uniforms.M && n < uniforms.N) {
      output[m * uniforms.N + n] = value;
    }
  }`;
    };
    return m ? { name: "GemmShared", shaderCache: { hint: `${e4.cacheKey}`, inputDependencies: b }, getRunData: () => ({ outputs: [{ dims: u, dataType: t[0].dataType }], dispatchGroup: { x: c2 * p4 }, programUniforms: y }), getShaderSource: T } : { name: "Gemm", shaderCache: { hint: `${e4.cacheKey}`, inputDependencies: b }, getRunData: () => ({ outputs: [{ dims: u, dataType: t[0].dataType }], dispatchGroup: { x: Math.ceil(g / 64) }, programUniforms: y }), getShaderSource: _ };
  }, _l = (t) => {
    let e4 = t.transA, r = t.transB, n = t.alpha, o = t.beta;
    return { transA: e4, transB: r, alpha: n, beta: o, cacheKey: `${t.transA};${t.transB};${t.alpha === 1}` };
  }, wl = (t, e4) => {
    yg(t.inputs), t.compute(_g(t.inputs, e4));
  };
});
var mt;
var Tt;
var Ht;
var Ft;
var wg;
var vg;
var $g;
var xg;
var Sg;
var Tg;
var Ig;
var Cg;
var $l;
var xl;
var Sl = V(() => {
  "use strict";
  J();
  re();
  Ce();
  oe();
  [mt, Tt, Ht, Ft] = [0, 1, 2, 3], wg = (t) => {
    if (t[0].dims.length !== 4) throw new Error("only 4-D tensor is supported.");
    if (t[0].dims.length !== t[1].dims.length) throw new Error("input dimensions must be equal to grid dimensions");
    if (t[0].dims.length - 2 !== t[1].dims[t[1].dims.length - 1]) throw new Error(`last dimension of grid must be equal to ${t[0].dims.length - 2}`);
    if (t[0].dims[0] !== t[1].dims[0]) throw new Error("grid batch size must match input batch size");
  }, vg = `
  fn gs_get_cubic_coeffs(x: f32) -> vec4<f32> {
    let cubic_alpha = -0.75f;
    let x_abs = abs(x);
    var coeffs: vec4<f32>;
    coeffs[0] = (((cubic_alpha * (x_abs + 1) - 5 * cubic_alpha) * (x_abs + 1) + 8 * cubic_alpha) * (x_abs + 1) - 4 * cubic_alpha);
    coeffs[1] = (((cubic_alpha + 2) * x_abs - (cubic_alpha + 3)) * x_abs * x_abs + 1);
    coeffs[2] = (((cubic_alpha + 2) * (1 - x_abs) - (cubic_alpha + 3)) * (1 - x_abs) * (1 - x_abs) + 1);
    coeffs[3] = (((cubic_alpha * (2 - x_abs) - 5 * cubic_alpha) * (2 - x_abs) + 8 * cubic_alpha) * (2 - x_abs) - 4 * cubic_alpha);
    return coeffs;
  }
`, $g = (t) => `
  fn gs_bicubic_interpolate(p: mat4x4<${t}>, x: f32, y: f32) -> ${t} {
    var v: vec4<f32>;
    var coeffs = gs_get_cubic_coeffs(x);
    for (var i = 0; i < 4; i++) {
      v[i] = coeffs[0] * p[i][0] + coeffs[1] * p[i][1] + coeffs[2] * p[i][2] + coeffs[3] * p[i][3];
    }
    coeffs = gs_get_cubic_coeffs(y);
    let pixel = ${t}(coeffs[0] * v[0] + coeffs[1] * v[1] + coeffs[2] * v[2] + coeffs[3] * v[3]);
    return pixel;
  }
`, xg = (t) => `
  fn gs_denormalize(n: f32, length: i32) -> f32 {
    ${t.alignCorners === 0 ? `
    // alignCorners: false => [-1, 1] to [-0.5, length - 0.5]
    return ((n + 1.0) * f32(length) - 1.0) / 2.0;
    ` : `
    // alignCorners: true => [-1, 1] to [0, length - 1]
    return (n + 1.0) / 2.0 * (f32(length - 1));
    `}
  }
`, Sg = (t) => `
  ${t.paddingMode === "reflection" ? `
      fn gs_reflect(x: i32, x_min: f32, x_max: f32) -> u32 {
        var dx = 0.0;
        var fx = f32(x);
        let range = x_max - x_min;
        if (fx < x_min) {
          dx = x_min - fx;
          let n = u32(dx / range);
          let r = dx - f32(n) * range;
          if (n % 2 == 0) {
            fx = x_min + r;
          } else {
            fx = x_max - r;
          }
        } else if (fx > x_max) {
          dx = fx - x_max;
          let n = u32(dx / range);
          let r = dx - f32(n) * range;
          if (n % 2 == 0) {
            fx = x_max - r;
          } else {
            fx = x_min + r;
          }
        }
        return u32(fx);
      }` : ""}
`, Tg = (t, e4, r) => `
  fn pixel_at_grid(r: i32, c: i32, H: i32, W: i32, batch: u32, channel: u32, border: vec4<f32>) -> ${e4} {
     var pixel = ${e4}(0);
     var indices = vec4<u32>(0);
     indices[${mt}] = batch;
     indices[${Tt}] = channel;` + (() => {
    switch (r.paddingMode) {
      case "zeros":
        return `
          if (r >= 0 && r < H && c >=0 && c < W) {
            indices[${Ht}] = u32(r);
            indices[${Ft}] = u32(c);
          } else {
            return ${e4}(0);
          }
        `;
      case "border":
        return `
          indices[${Ht}] = u32(clamp(r, 0, H - 1));
          indices[${Ft}] = u32(clamp(c, 0, W - 1));
        `;
      case "reflection":
        return `
          indices[${Ht}] = gs_reflect(r, border[1], border[3]);
          indices[${Ft}] = gs_reflect(c, border[0], border[2]);
        `;
      default:
        throw new Error(`padding mode ${r.paddingMode} is not supported`);
    }
  })() + `
    return ${t.getByIndices("indices")};
  }
`, Ig = (t, e4, r) => (() => {
    switch (r.mode) {
      case "nearest":
        return `
          let result = pixel_at_grid(i32(round(y)), i32(round(x)), H_in, W_in, indices[${mt}], indices[${Tt}], border);
        `;
      case "bilinear":
        return `
          let x1 = i32(floor(x));
          let y1 = i32(floor(y));
          let x2 = x1 + 1;
          let y2 = y1 + 1;

          let p11 = pixel_at_grid(y1, x1, H_in, W_in, indices[${mt}], indices[${Tt}], border);
          let p12 = pixel_at_grid(y1, x2, H_in, W_in, indices[${mt}], indices[${Tt}], border);
          let p21 = pixel_at_grid(y2, x1, H_in, W_in, indices[${mt}], indices[${Tt}], border);
          let p22 = pixel_at_grid(y2, x2, H_in, W_in, indices[${mt}], indices[${Tt}], border);

          let dx2 = ${e4}(f32(x2) - x);
          let dx1 = ${e4}(x - f32(x1));
          let dy2 = ${e4}(f32(y2) - y);
          let dy1 = ${e4}(y - f32(y1));
          let result = dy2 * (dx2 * p11 + dx1 * p12) + dy1 * (dx2 * p21 + dx1 * p22);
        `;
      case "bicubic":
        return `
          let x0 = i32(floor(x)) - 1;
          let y0 = i32(floor(y)) - 1;
          var p: mat4x4<${e4}>;
          for (var h = 0; h < 4; h++) {
            for (var w = 0; w < 4; w++) {
              p[h][w] = pixel_at_grid(h + y0, w + x0, H_in, W_in, indices[${mt}], indices[${Tt}], border);
            }
          }

          let dx = x - f32(x0 + 1);
          let dy = y - f32(y0 + 1);
          let result = gs_bicubic_interpolate(p, dx, dy);
        `;
      default:
        throw new Error(`mode ${r.mode} is not supported`);
    }
  })() + `${t.setByOffset("global_idx", "result")}`, Cg = (t, e4) => {
    let r = O("x", t[0].dataType, t[0].dims.length), n = [t[1].dims[0], t[1].dims[1], t[1].dims[2]], o = O("grid", t[1].dataType, n.length, 2), i = [t[0].dims[0], t[0].dims[1], t[1].dims[1], t[1].dims[2]];
    e4.format === "NHWC" && (i = [t[0].dims[0], t[1].dims[1], t[1].dims[2], t[0].dims[3]], [mt, Tt, Ht, Ft] = [0, 3, 1, 2]);
    let s = U("output", t[0].dataType, i.length), u = r.type.value, d = k4.size(i), c2 = [{ type: 12, data: d }, ...W(t[0].dims, n, i)], p4 = (m) => `
  ${m.registerUniform("output_size", "u32").declareVariables(r, o, s)}
  ${vg}
  ${$g(u)}
  ${xg(e4)}
  ${Sg(e4)}
  ${Tg(r, u, e4)}

  ${m.mainStart()}
    ${m.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
      let H_in = i32(uniforms.x_shape[${Ht}]);
      let W_in = i32(uniforms.x_shape[${Ft}]);

      ${e4.alignCorners === 0 ? `
      let x_min = -0.5;
      let x_max = f32(W_in) - 0.5;
      let y_min = -0.5;
      let y_max = f32(H_in) - 0.5;
      ` : `
      let x_min = 0.0;
      let x_max = f32(W_in) - 1.0;
      let y_min = 0.0;
      let y_max = f32(H_in) - 1.0;
      `};
      let border = vec4<f32>(x_min, y_min, x_max, y_max);

      let indices = ${s.offsetToIndices("global_idx")};
      var grid_indices = vec3<u32>(indices[${mt}], indices[${Ht}], indices[${Ft}]);
      let nxy = ${o.getByIndices("grid_indices")};
      var x = gs_denormalize(f32(nxy[0]), W_in);
      var y = gs_denormalize(f32(nxy[1]), H_in);

      ${Ig(s, u, e4)}
  }`;
    return { name: "GridSample", shaderCache: { hint: `${e4.cacheKey}`, inputDependencies: ["type", "type"] }, getRunData: (m) => {
      let g = k4.size(i);
      return { outputs: [{ dims: i, dataType: m[0].dataType }], dispatchGroup: { x: Math.ceil(g / 64) }, programUniforms: c2 };
    }, getShaderSource: p4 };
  }, $l = (t, e4) => {
    wg(t.inputs), t.compute(Cg(t.inputs, e4));
  }, xl = (t) => ee({ alignCorners: t.align_corners, mode: t.mode, paddingMode: t.padding_mode, format: t.format });
});
var Ue;
var kg;
var Il;
var Tl;
var Pg;
var sr;
var Cl;
var ko = V(() => {
  "use strict";
  J();
  re();
  Ce();
  jr();
  Jr();
  oe();
  pt();
  Ue = (t, e4) => t.length > e4 && t[e4].dims.length > 0 ? t[e4] : void 0, kg = (t, e4) => {
    let r = t[0], n = Ue(t, 1), o = Ue(t, 2), i = Ue(t, 3), s = Ue(t, 4), u = Ue(t, 5), d = Ue(t, 6), c2 = Ue(t, 7);
    if (r.dims.length !== 3 && r.dims.length !== 5) throw new Error("Input query is expected to have 3 or 5 dimensions");
    let p4 = r.dims[0], m = r.dims[1], g = r.dims.length === 3 ? r.dims[2] : e4.numHeads * r.dims[4], y = m, b = 0, _ = 0, T = Math.floor(g / e4.numHeads);
    if (d && c2 && k4.size(d.dims) && k4.size(c2.dims)) {
      if (d.dims.length !== 4) throw new Error('Input "past_key" is expected to have 4 dimensions');
      if (d.dims[0] !== p4 || d.dims[1] !== e4.numHeads || d.dims[3] !== T) throw new Error('Input "past_key" shape (batch_size, num_heads, past_sequence_length, head_size)');
      if (c2.dims[0] !== p4 || c2.dims[1] !== e4.numHeads || c2.dims[3] !== T) throw new Error('Input "past_value" shape (batch_size, num_heads, past_sequence_length, head_size)');
      if (d.dims[2] !== c2.dims[2]) throw new Error('Input "past_key" and "past_value" shall have same dim 2 (past_sequence_length)');
      if (c2.dims.length !== 4) throw new Error('Input "past_value" is expected to have 4 dimensions');
      b = d.dims[2], _ = d.dims[2];
    } else if (d && k4.size(d.dims) || c2 && k4.size(c2.dims)) throw new Error('Input "past_key" and "past_value" shall be both present or both absent');
    let x;
    if (n && k4.size(n.dims) > 0) {
      if (r.dims.length !== 3) throw new Error('Input "query" is expected to have 3 dimensions when key is given');
      if (n.dims.length < 3 || n.dims.length > 5) throw new Error('Input "key" is expected to have 3, 4, or 5 dimensions');
      if (r.dims[0] !== n.dims[0]) throw new Error('Input "query" and "key" shall have same dim 0 (batch size)');
      if (n.dims.length === 3) {
        if (n.dims[2] !== r.dims[2]) throw new Error('Input "query" and "key" shall have same dim 2 (hidden_size)');
        x = 2, y = n.dims[1];
      } else if (n.dims.length === 5) {
        if (n.dims[2] !== e4.numHeads || n.dims[3] !== 2 || n.dims[4] !== T) throw new Error('Expect "key" shape (batch_size, kv_sequence_length, num_heads, 2, head_size) for packed kv');
        if (o) throw new Error('Expect "value" be none when "key" has packed kv format.');
        x = 5, y = n.dims[1];
      } else {
        if (n.dims[1] !== e4.numHeads || n.dims[3] !== T) throw new Error('Expect "key" shape (batch_size, num_heads, kv_sequence_length, head_size) for past_key');
        x = 0, y = n.dims[2];
      }
    } else {
      if (r.dims.length !== 5) throw new Error('Input "query" is expected to have 5 dimensions when key is empty');
      if (r.dims[2] !== e4.numHeads || r.dims[3] !== 3) throw new Error('Expect "query" shape (batch_size, kv_sequence_length, num_heads, 3, head_size) for packed kv');
      x = 3;
    }
    if (i && k4.size(i.dims) > 0) {
      if (i.dims.length !== 1) throw new Error('Input "bias" is expected to have 1 dimension');
      if (n && n.dims.length === 5 && n.dims[3] === 2) throw new Error("bias is not allowed for packed kv.");
    }
    let $ = b + y, S = 0;
    if (s && k4.size(s.dims) > 0) {
      S = 8;
      let z = s.dims;
      throw z.length === 1 ? z[0] === p4 ? S = 1 : z[0] === 3 * p4 + 2 && (S = 3) : z.length === 2 && z[0] === p4 && z[1] === $ && (S = 5), S === 8 ? new Error('Input "key_padding_mask" shape shall be (batch_size) or (batch_size, total_sequence_length)') : new Error("Mask not supported");
    }
    let I = false, E = g;
    if (o && k4.size(o.dims) > 0) {
      if (o.dims.length !== 3 && o.dims.length !== 4) throw new Error('Input "value" is expected to have 3 or 4 dimensions');
      if (r.dims[0] !== o.dims[0]) throw new Error('Input "query" and "value" shall have same dim 0 (batch_size)');
      if (o.dims.length === 3) {
        if (y !== o.dims[1]) throw new Error('Input "key" and "value" shall have the same dim 1 (kv_sequence_length)');
        E = o.dims[2];
      } else {
        if (y !== o.dims[2]) throw new Error('Input "key" and "value" shall have the same dim 2 (kv_sequence_length)');
        E = o.dims[1] * o.dims[3], I = true;
      }
    }
    let A = false;
    if (s && k4.size(s.dims) > 0) throw new Error("Key padding mask is not supported");
    if (u && k4.size(u.dims) > 0) {
      if (u.dims.length !== 4) throw new Error('Input "attention_bias" is expected to have 4 dimensions');
      if (u.dims[0] !== p4 || u.dims[1] !== e4.numHeads || u.dims[2] !== m || u.dims[3] !== $) throw new Error('Expect "attention_bias" shape (batch_size, num_heads, sequence_length, total_sequence_length)');
    }
    return { batchSize: p4, sequenceLength: m, pastSequenceLength: b, kvSequenceLength: y, totalSequenceLength: $, maxSequenceLength: _, inputHiddenSize: 0, hiddenSize: g, vHiddenSize: E, headSize: T, vHeadSize: Math.floor(E / e4.numHeads), numHeads: e4.numHeads, isUnidirectional: false, pastPresentShareBuffer: false, maskFilterValue: e4.maskFilterValue, maskType: S, scale: e4.scale, broadcastResPosBias: A, passPastInKv: I, qkvFormat: x };
  }, Il = (t) => ee({ ...t }), Tl = ee({ perm: [0, 2, 1, 3] }), Pg = (t, e4, r, n, o, i, s) => {
    let u = [n, o, i], d = k4.size(u), c2 = [{ type: 12, data: d }, { type: 12, data: s }, { type: 12, data: i }], p4 = (m) => {
      let g = U("qkv_with_bias", e4.dataType, u), y = O("qkv", e4.dataType, u), b = O("bias", r.dataType, u), _ = [{ name: "output_size", type: "u32" }, { name: "bias_offset", type: "u32" }, { name: "hidden_size", type: "u32" }];
      return `
  ${m.registerUniforms(_).declareVariables(y, b, g)}
  ${m.mainStart()}
    ${m.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    let bias_offset_idx = (global_idx % uniforms.hidden_size) + uniforms.bias_offset;

    qkv_with_bias[global_idx] = qkv[global_idx] + bias[bias_offset_idx];
  }`;
    };
    return t.compute({ name: "MultiHeadAttentionAddBias", shaderCache: { inputDependencies: ["type", "type"] }, getRunData: () => ({ outputs: [{ dims: u, dataType: e4.dataType, gpuDataType: 0 }], dispatchGroup: { x: Math.ceil(d / 64) }, programUniforms: c2 }), getShaderSource: p4 }, { inputs: [e4, r], outputs: [-1] })[0];
  }, sr = (t, e4, r, n, o, i, s, u) => {
    let d = i;
    if (s && k4.size(s.dims) > 0) {
      if (n === 1) throw new Error("AddBiasReshape is not implemented. Please export your model with packed QKV or KV");
      return d = Pg(t, i, s, e4, n, r * o, u), d = d.reshape([e4, n, r, o]), r === 1 || n === 1 ? d : t.compute(Be(d, Tl.perm), { inputs: [d], outputs: [-1] })[0];
    } else return i.dims.length === 3 && (d = i.reshape([e4, n, r, o])), r === 1 || n === 1 ? d : t.compute(Be(d, Tl.perm), { inputs: [d], outputs: [-1] })[0];
  }, Cl = (t, e4) => {
    let r = kg(t.inputs, e4), n = t.inputs[0], o = Ue(t.inputs, 1), i = Ue(t.inputs, 2), s = Ue(t.inputs, 3), u = Ue(t.inputs, 4), d = Ue(t.inputs, 5), c2 = Ue(t.inputs, 6), p4 = Ue(t.inputs, 7);
    if (n.dims.length === 5) throw new Error("Packed QKV is not implemented");
    if (o?.dims.length === 5) throw new Error("Packed KV is not implemented");
    let m = o && i && o.dims.length === 4 && i.dims.length === 4, g = sr(t, r.batchSize, r.numHeads, r.sequenceLength, r.headSize, n, s, 0);
    if (m) return Gt(t, g, o, i, u, void 0, c2, p4, d, r);
    if (!o || !i) throw new Error("key and value must be provided");
    let y = sr(t, r.batchSize, r.numHeads, r.kvSequenceLength, r.headSize, o, s, r.hiddenSize), b = sr(t, r.batchSize, r.numHeads, r.kvSequenceLength, r.vHeadSize, i, s, 2 * r.hiddenSize);
    Gt(t, g, y, b, u, void 0, c2, p4, d, r);
  };
});
var Og;
var zg;
var Bg;
var Dg;
var Po;
var Al;
var El;
var Oo = V(() => {
  "use strict";
  J();
  re();
  Ce();
  oe();
  Og = (t) => {
    if (!t || t.length < 1) throw new Error("too few inputs");
  }, zg = (t, e4) => {
    let r = [], n = e4.numOutputs;
    return t[1].dims[0] > 0 && (t[1].getBigInt64Array().forEach((o) => r.push(Number(o))), n = r.length), ee({ numOutputs: n, axis: e4.axis, splitSizes: r });
  }, Bg = (t) => `
fn calculateOutputIndex(index: u32) -> u32 {
    for (var i: u32 = 0u; i < ${t}u; i += 1u ) {
    if (index < ${j("uniforms.size_in_split_axis", "i", t)}) {
        return i;
    }
    }
    return ${t}u;
}`, Dg = (t) => {
    let e4 = t.length, r = [];
    for (let n = 0; n < e4; ++n) {
      let o = t[n].setByIndices("indices", "input[global_idx]");
      e4 === 1 ? r.push(o) : n === 0 ? r.push(`if (output_number == ${n}u) { ${o} }`) : n === e4 - 1 ? r.push(`else { ${o} }`) : r.push(`else if (output_number == ${n}) { ${o} }`);
    }
    return `
      fn writeBufferData(output_number: u32, indices: ${t[0].type.indices}, global_idx: u32) {
        ${r.join(`
`)}
      }`;
  }, Po = (t, e4) => {
    let r = t[0].dims, n = k4.size(r), o = t[0].dataType, i = k4.normalizeAxis(e4.axis, r.length), s = new Array(e4.numOutputs), u = O("input", o, r.length), d = new Array(e4.numOutputs), c2 = [], p4 = [], m = 0, g = [{ type: 12, data: n }];
    for (let b = 0; b < e4.numOutputs; b++) {
      m += e4.splitSizes[b], d[b] = m;
      let _ = r.slice();
      _[i] = e4.splitSizes[b], p4.push(_), s[b] = U(`output${b}`, o, _.length), c2.push({ dims: p4[b], dataType: t[0].dataType });
    }
    g.push({ type: 12, data: d }, ...W(r, ...p4));
    let y = (b) => `
  ${b.registerUniform("input_size", "u32").registerUniform("size_in_split_axis", "u32", d.length).declareVariables(u, ...s)}
  ${Bg(d.length)}
  ${Dg(s)}

  ${b.mainStart()}
    ${b.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.input_size")}

    var indices = ${u.offsetToIndices("global_idx")};
    var index = ${u.indicesGet("indices", i)};
    let output_number = calculateOutputIndex(index);
    if (output_number != 0) {
      index -= ${j("uniforms.size_in_split_axis", "output_number - 1u", d.length)};
      ${u.indicesSet("indices", i, "index")};
    }
    writeBufferData(output_number, indices, global_idx);
  }`;
    return { name: "Split", shaderCache: { hint: e4.cacheKey, inputDependencies: ["rank"] }, getShaderSource: y, getRunData: () => ({ outputs: c2, dispatchGroup: { x: Math.ceil(n / 64) }, programUniforms: g }) };
  }, Al = (t, e4) => {
    Og(t.inputs);
    let r = t.inputs.length === 1 ? e4 : zg(t.inputs, e4);
    t.compute(Po(t.inputs, r), { inputs: [0] });
  }, El = (t) => {
    let e4 = t.axis, r = t.splitSizes, n = t.numOutputs < 0 ? r.length : t.numOutputs;
    if (n !== r.length) throw new Error("numOutputs and splitSizes length must be equal");
    return ee({ axis: e4, numOutputs: n, splitSizes: r });
  };
});
var Mg;
var ln;
var kl;
var zo = V(() => {
  "use strict";
  J();
  re();
  Ce();
  oe();
  Mg = (t, e4) => {
    let [r, n, o, i] = t, { numHeads: s, rotaryEmbeddingDim: u } = e4;
    if (r.dims.length !== 3 && r.dims.length !== 4) throw new Error(`Input 'x' is expected to have 3 or 4 dimensions, got ${r.dims.length}`);
    if (!k4.areEqual(n.dims, []) && !k4.areEqual(n.dims, [1]) && n.dims.length !== 2) throw new Error(`Input 'position_ids' is expected to have 0, 1, or 2 dimensions, got ${n.dims.length}`);
    if (o.dims.length !== 2) throw new Error(`Input 'cos_cache' is expected to have 2 dimensions, got ${o.dims.length}`);
    if (i.dims.length !== 2) throw new Error(`Input 'sin_cache' is expected to have 2 dimensions, got ${i.dims.length}`);
    if (!k4.areEqual(o.dims, i.dims)) throw new Error("Inputs 'cos_cache' and 'sin_cache' are expected to have the same shape");
    if (u > 0 && s === 0) throw new Error("num_heads must be provided if rotary_embedding_dim is specified");
    let d = r.dims[0], c2 = r.dims[r.dims.length - 2], p4 = o.dims[0], m = k4.sizeFromDimension(r.dims, 1) / c2, g = u === 0 ? o.dims[1] * 2 : m / s;
    if (u > g) throw new Error("rotary_embedding_dim must be less than or equal to head_size");
    if (n.dims.length === 2) {
      if (d !== n.dims[0]) throw new Error(`Input 'position_ids' dimension 0 should be of size batch_size, got ${n.dims[0]}`);
      if (c2 !== n.dims[1]) throw new Error(`Input 'position_ids' dimension 1 should be of size sequence_length, got ${n.dims[1]}`);
    }
    if (c2 > p4) throw new Error("Updating cos_cache and sin_cache in RotaryEmbedding is not currently supported");
    if (g / 2 !== o.dims[1] && u / 2 !== o.dims[1]) throw new Error(`Input 'cos_cache' dimension 1 should be same as head_size / 2 or rotary_embedding_dim / 2, got ${o.dims[1]}`);
  }, ln = (t, e4) => {
    let { interleaved: r, numHeads: n, rotaryEmbeddingDim: o, scale: i } = e4, s = t[0].dims[0], u = k4.sizeFromDimension(t[0].dims, 1), d = t[0].dims[t[0].dims.length - 2], c2 = u / d, p4 = t[2].dims[1], m = o === 0 ? p4 * 2 : c2 / n, g = new Array(s, d, c2 / m, m - p4), y = k4.computeStrides(g), b = [{ type: 1, data: i }, { type: 12, data: g }, { type: 12, data: y }, ...t[0].dims.length === 3 ? new Array({ type: 12, data: [u, c2, m, 1] }) : [], ...t[0].dims.length === 4 ? new Array({ type: 12, data: [u, m, d * m, 1] }) : [], ...W(t[0].dims, t[1].dims, t[2].dims, t[3].dims, t[0].dims)], _ = (T) => {
      let x = O("input", t[0].dataType, t[0].dims.length), $ = O("position_ids", t[1].dataType, t[1].dims.length), S = O("cos_cache", t[2].dataType, t[2].dims.length), I = O("sin_cache", t[3].dataType, t[3].dims.length), E = U("output", t[0].dataType, t[0].dims.length);
      return T.registerUniforms([{ name: "scale", type: "f32" }, { name: "global_shape", type: "u32", length: g.length }, { name: "global_strides", type: "u32", length: y.length }, { name: "input_output_strides", type: "u32", length: y.length }]), `
        ${T.declareVariables(x, $, S, I, E)}

        ${T.mainStart(Bt)}
          let half_rotary_emb_dim = uniforms.${S.name}_shape[1];
          let bsnh = global_idx / uniforms.global_strides % uniforms.global_shape;
          let size = uniforms.global_shape[0] * uniforms.global_strides[0];
          ${T.guardAgainstOutOfBoundsWorkgroupSizes("size")}

          if (bsnh[3] < half_rotary_emb_dim) {
            let position_ids_idx =
                ${$.broadcastedIndicesToOffset("bsnh.xy", U("", $.type.tensor, 2))};
            let position_id =
                u32(${$.getByOffset("position_ids_idx")}) + select(0, bsnh[1], position_ids_idx == 0);
            let i = dot(bsnh, uniforms.input_output_strides) + select(0, bsnh[3], ${r});
            let j = i + select(half_rotary_emb_dim, 1, ${r});
            let re = ${x.getByOffset("i")} * ${S.get("position_id", "bsnh[3]")} -
                ${x.getByOffset("j")} * ${I.get("position_id", "bsnh[3]")};
            ${E.setByOffset("i", "re")}
            let im = ${x.getByOffset("i")} * ${I.get("position_id", "bsnh[3]")} +
                ${x.getByOffset("j")} * ${S.get("position_id", "bsnh[3]")};
            ${E.setByOffset("j", "im")}
          } else {
            let k = dot(bsnh, uniforms.input_output_strides) + half_rotary_emb_dim;
            ${E.setByOffset("k", x.getByOffset("k"))}
          }
        }`;
    };
    return { name: "RotaryEmbedding", shaderCache: { hint: ee({ interleaved: r }).cacheKey, inputDependencies: ["rank", "rank", "rank", "rank"] }, getShaderSource: _, getRunData: () => ({ outputs: [{ dims: t[0].dims, dataType: t[0].dataType }], dispatchGroup: { x: Math.ceil(k4.size(g) / Bt) }, programUniforms: b }) };
  }, kl = (t, e4) => {
    Mg(t.inputs, e4), t.compute(ln(t.inputs, e4));
  };
});
var Rg;
var Ug;
var Pl;
var Ng;
var Ol;
var zl = V(() => {
  "use strict";
  Ce();
  J();
  Jr();
  ko();
  Oo();
  pt();
  zo();
  oe();
  Rg = (t, e4) => {
    if (e4.doRotary && t.length <= 7) throw new Error("cos_cache and sin_cache inputs are required if do_rotary is specified");
    let r = t[0], n = t[1], o = t[2], i = t[3], s = t[4];
    if (e4.doRotary !== 0 && t.length <= 7) throw new Error("cos_cast and sin_cache are expected if do_rotary attribute is non-zero");
    if (e4.localWindowSize !== -1) throw new Error("Local attention is not supported");
    if (e4.softcap !== 0) throw new Error("Softcap is not supported");
    if (e4.rotaryInterleaved !== 0) throw new Error("Rotary interleaved is not supported");
    if (e4.smoothSoftmax) throw new Error("Smooth softmax is not supported");
    if (r.dims.length !== 3 && r.dims.length !== 5) throw new Error("Input query is expected to have 3 or 5 dimensions");
    let u = false, d = r.dims[0], c2 = r.dims[1], p4 = r.dims.length === 3 ? u ? r.dims[2] / 3 : r.dims[2] : e4.numHeads * r.dims[4], m = c2, g = 0, y = !n || n.dims.length === 0, b = Math.floor(y ? p4 / (e4.numHeads + 2 * e4.kvNumHeads) : p4 / e4.numHeads);
    y && (p4 = b * e4.numHeads);
    let _ = i && i.dims.length !== 0, T = s && s.dims.length !== 0;
    if (_ && i.dims.length === 4 && i.dims[0] === d && i.dims[1] !== e4.kvNumHeads && i.dims[2] === e4.kvNumHeads && i.dims[3] === b) throw new Error("BSNH pastKey/pastValue is not supported");
    if (_ && T) {
      if (i.dims.length !== 4) throw new Error('Input "past_key" is expected to have 4 dimensions');
      if (s.dims.length !== 4) throw new Error('Input "past_value" is expected to have 4 dimensions');
      g = i.dims[2];
    } else if (_ || T) throw new Error('Input "past_key" and "past_value" shall be both present or both absent');
    let $ = 1;
    if (n && n.dims.length > 0) {
      if (r.dims.length !== 3) throw new Error('Input "query" is expected to have 3 dimensions when key is given');
      if (n.dims.length < 3 || n.dims.length > 5) throw new Error('Input "key" is expected to have 3, 4, or 5 dimensions');
      if (r.dims[0] !== n.dims[0]) throw new Error('Input "query" and "key" shall have same dim 0 (batch size)');
      if (n.dims.length === 3) {
        if (r.dims[2] % n.dims[2] !== 0) throw new Error('Dimension 2 of "query" should be a multiple of "key"');
        m = n.dims[1];
      } else if (n.dims.length === 5) {
        if (n.dims[2] !== e4.numHeads || n.dims[3] !== 2 || n.dims[4] !== b) throw new Error('Expect "key" shape (batch_size, kv_sequence_length, num_heads, 2, head_size) for packed kv');
        if (o) throw new Error('Expect "value" be none when "key" has packed kv format.');
        m = n.dims[1];
      } else {
        if (n.dims[1] !== e4.numHeads || n.dims[3] !== b) throw new Error('Expect "key" shape (batch_size, num_heads, kv_sequence_length, head_size) for past_key');
        m = n.dims[2];
      }
    } else {
      if (r.dims.length !== 3 && r.dims.length !== 5) throw new Error('Input "query" is expected to have 3 or 5 dimensions when key is empty');
      if (r.dims.length === 5 && (r.dims[2] !== e4.numHeads || r.dims[3] !== 3)) throw new Error('Expect "query" shape (batch_size, kv_sequence_length, num_heads, 3, head_size) for packed kv');
      $ = 3;
    }
    let S = 0, I = false, E = e4.kvNumHeads ? b * e4.kvNumHeads : p4;
    if (o && o.dims.length > 0) {
      if (o.dims.length !== 3 && o.dims.length !== 4) throw new Error('Input "value" is expected to have 3 or 4 dimensions');
      if (r.dims[0] !== o.dims[0]) throw new Error('Input "query" and "value" shall have same dim 0 (batch_size)');
      if (o.dims.length === 3) {
        if (m !== o.dims[1]) throw new Error('Input "key" and "value" shall have the same dim 1 (kv_sequence_length)');
        E = o.dims[2];
      } else {
        if (m !== o.dims[2]) throw new Error('Input "past_key" and "past_value" shall have the same dim 2 (kv_sequence_length)');
        E = o.dims[1] * o.dims[3], I = true;
      }
    }
    let A = t.length > 4 ? t[5] : void 0;
    if (A) {
      if (A.dims.length === 0) throw new Error("seqlens_k must be at least 1D, got scalar.");
      let N = A.dims.reduce((F, q) => F * q, 1);
      if (N !== d) throw new Error(`seqlens_k must have batch_size (${d}) elements, got ${N}.`);
      for (let F = 0; F < A.dims.length; F++) if (A.dims[F] !== 1 && A.dims[F] !== d) throw new Error(`seqlens_k has unexpected shape. Each dimension must be 1 or batch_size (${d}), got dims[${F}] = ${A.dims[F]}.`);
    }
    return { batchSize: d, sequenceLength: c2, pastSequenceLength: g, kvSequenceLength: m, totalSequenceLength: -1, maxSequenceLength: -1, inputHiddenSize: 0, hiddenSize: p4, vHiddenSize: E, headSize: b, vHeadSize: Math.floor(E / e4.kvNumHeads), numHeads: e4.numHeads, kvNumHeads: e4.kvNumHeads, nReps: e4.numHeads / e4.kvNumHeads, pastPresentShareBuffer: false, maskType: S, scale: e4.scale, broadcastResPosBias: false, passPastInKv: I, qkvFormat: $ };
  }, Ug = ee({ perm: [0, 2, 1, 3] }), Pl = (t, e4, r) => {
    let n = e4, o = r.kvNumHeads;
    return e4.dims.length === 3 && r.kvSequenceLength !== 0 && (n = e4.reshape([r.batchSize, r.kvSequenceLength, o, r.headSize]), n = t.compute(Be(n, Ug.perm), { inputs: [n], outputs: [-1] })[0]), n;
  }, Ng = (t, e4, r, n) => {
    let o = 7, i = ["type", "type"], s = [t * e4], u = t * e4, d = [{ type: 12, data: u }, { type: 12, data: e4 }, { type: 12, data: t }], c2 = (p4) => {
      let m = O("seq_lens", r.dataType, r.dims), g = O("total_seq_lens", n.dataType, n.dims), y = U("pos_ids", o, s), b = [{ name: "output_size", type: "u32" }, { name: "sequence_length", type: "u32" }, { name: "batch_size", type: "u32" }];
      return `
  ${p4.registerUniforms(b).declareVariables(m, g, y)}
  ${p4.mainStart()}
    ${p4.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    let total_sequence_length = u32(${g.getByOffset("0")});
    let is_subsequent_prompt = uniforms.sequence_length > 1 && uniforms.sequence_length != total_sequence_length;
    let is_first_prompt = !is_subsequent_prompt && uniforms.sequence_length == total_sequence_length;
    let batch_idx = global_idx / uniforms.sequence_length;
    let sequence_idx = i32(global_idx % uniforms.sequence_length);
    var pos_id: i32 = 0;
    let seqlen = ${m.getByOffset("batch_idx")};
    let total_seqlen = seqlen + 1;
    if (is_first_prompt) {
      if (sequence_idx < total_seqlen) {
        pos_id = sequence_idx;
      } else {
        pos_id = 1;
      }
      ${y.setByOffset("global_idx", "pos_id")}
    } else if (is_subsequent_prompt) {
      let past_seqlen = total_seqlen - i32(uniforms.sequence_length);
      if (past_seqlen + sequence_idx < total_seqlen) {
        pos_id = past_seqlen + sequence_idx;
      } else {
        pos_id = 1;
      }
      ${y.setByOffset("global_idx", "pos_id")}
    } else if (global_idx < uniforms.batch_size) {
      ${y.setByOffset("global_idx", "seqlen")}
    };
  }
  `;
    };
    return { name: "GeneratePositionIds", shaderCache: { hint: `${t};${e4}`, inputDependencies: i }, getRunData: () => ({ outputs: [{ dims: s, dataType: o }], dispatchGroup: { x: Math.ceil(u / 64) }, programUniforms: d }), getShaderSource: c2 };
  }, Ol = (t, e4) => {
    let r = Rg(t.inputs, e4);
    if (t.inputs[0].dims.length === 5) throw new Error("Packed QKV is not implemented");
    if (t.inputs[1]?.dims.length === 5) throw new Error("Packed KV is not implemented");
    let n = t.inputs[0], o = t.inputs[1] && t.inputs[1].dims.length > 0 ? t.inputs[1] : void 0, i = t.inputs[2] && t.inputs[2].dims.length > 0 ? t.inputs[2] : void 0, s = t.inputs[3] && t.inputs[3].dims.length !== 0 ? t.inputs[3] : void 0, u = t.inputs[4] && t.inputs[4].dims.length !== 0 ? t.inputs[4] : void 0, d = t.inputs.length > 4 ? t.inputs[5] : void 0, c2 = t.inputs.length > 5 ? t.inputs[6] : void 0, p4 = r.kvNumHeads ? r.kvNumHeads : r.numHeads, m = ee({ axis: 2, numOutputs: 3, splitSizes: [r.numHeads * r.headSize, p4 * r.headSize, p4 * r.headSize] }), [g, y, b] = !o && !i ? t.compute(Po([n], m), { inputs: [n], outputs: [-1, -1, -1] }) : [n, o, i], _, T;
    if (e4.doRotary) {
      let I = t.compute(Ng(r.batchSize, r.sequenceLength, d, c2), { inputs: [d, c2], outputs: [-1] })[0], E = t.inputs[7], A = t.inputs[8], z = ee({ interleaved: e4.rotaryInterleaved !== 0, numHeads: r.numHeads, rotaryEmbeddingDim: 0, scale: e4.scale }), v = [g, I, E, A], R = [-1];
      _ = t.compute(ln(v, z), { inputs: v, outputs: R })[0], v.splice(0, 1, y);
      let N = ee({ interleaved: e4.rotaryInterleaved !== 0, numHeads: r.kvNumHeads, rotaryEmbeddingDim: 0, scale: e4.scale });
      T = t.compute(ln(v, N), { inputs: v, outputs: R })[0];
    }
    let x = sr(t, r.batchSize, r.numHeads, r.sequenceLength, r.headSize, e4.doRotary ? _ : g, void 0, 0), $ = Pl(t, e4.doRotary ? T : y, r), S = Pl(t, b, r);
    Gt(t, x, $, S, void 0, void 0, s, u, void 0, r, d, c2);
  };
});
var Bl;
var Vg;
var Lg;
var Dl;
var Ml = V(() => {
  "use strict";
  J();
  re();
  pt();
  oe();
  Bl = (t, e4, r, n, o, i, s, u) => {
    let d = fe(i), c2 = d === 1 ? "f32" : `vec${d}f`, p4 = d === 1 ? "vec2f" : `mat2x${d}f`, m = o * s, g = 64;
    m === 1 && (g = 256);
    let y = [o, s, i / d], b = [o, s, 2], _ = ["rank", "type", "type"], T = [];
    T.push(...W(y, b));
    let x = ($) => {
      let S = O("x", e4.dataType, 3, d), I = O("scale", r.dataType, r.dims), E = O("bias", n.dataType, n.dims), A = U("output", 1, 3, 2), z = [S, I, E, A];
      return `
  var<workgroup> workgroup_shared : array<${p4}, ${g}>;
  const workgroup_size = ${g}u;
  ${$.declareVariables(...z)}
  ${$.mainStart(g)}
    let batch = workgroup_index / uniforms.x_shape[1];
    let channel = workgroup_index % uniforms.x_shape[1];
    let hight = uniforms.x_shape[2];
    // initialize workgroup memory
    var sum = ${c2}(0);
    var squared_sum = ${c2}(0);
    for (var h = local_idx; h < hight; h += workgroup_size) {
      let value = ${c2}(${S.get("batch", "channel", "h")});
      sum += value;
      squared_sum += value * value;
    }
    workgroup_shared[local_idx] = ${p4}(sum, squared_sum);
    workgroupBarrier();

    for (var currSize = workgroup_size >> 1;  currSize > 0; currSize = currSize >> 1) {
      if (local_idx < currSize) {
        workgroup_shared[local_idx] = workgroup_shared[local_idx] + workgroup_shared[local_idx + currSize];
      }
      workgroupBarrier();
    }
    if (local_idx == 0) {
      let sum_final = ${Ze("workgroup_shared[0][0]", d)} / f32(hight * ${d});
      let squared_sum_final = ${Ze("workgroup_shared[0][1]", d)} / f32(hight * ${d});

      let inv_std_dev = inverseSqrt(squared_sum_final - sum_final * sum_final + f32(${u}));
      let channel_scale = inv_std_dev * f32(scale[channel]);
      let channel_shift = f32(bias[channel]) - sum_final * channel_scale;
      output[workgroup_index] = vec2f(channel_scale, channel_shift);
    }
  }`;
    };
    return t.compute({ name: "InstanceNormComputeChannelScaleShift", shaderCache: { hint: `${d};${u};${g}`, inputDependencies: _ }, getRunData: () => ({ outputs: [{ dims: b, dataType: 1 }], dispatchGroup: { x: m }, programUniforms: T }), getShaderSource: x }, { inputs: [e4, r, n], outputs: [-1] })[0];
  }, Vg = (t, e4, r) => {
    let n = e4[0].dims, o = n, i = 2, s = n[0], u = n[1], d = k4.sizeFromDimension(n, i), c2 = fe(d), p4 = k4.size(o) / c2, m = Bl(t, e4[0], e4[1], e4[2], s, d, u, r.epsilon), g = [s, u, d / c2], y = [s, u], b = ["type", "none"], _ = (T) => {
      let x = O("x", e4[0].dataType, g.length, c2), $ = O("scale_shift", 1, y.length, 2), S = U("output", e4[0].dataType, g.length, c2), I = [x, $, S];
      return `
  ${T.registerUniform("output_size", "u32").declareVariables(...I)}
  ${T.mainStart()}
  ${T.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
      let outputIndices = ${S.offsetToIndices("global_idx")};
      let batch = outputIndices[0];
      let channel = outputIndices[1];
      let scale_shift = ${$.getByIndices("vec2<u32>(batch, channel)")};
      let value = ${x.getByOffset("global_idx")} * ${S.type.value}(scale_shift.x) + ${S.type.value}(scale_shift.y);
      ${S.setByOffset("global_idx", "value")};
  }`;
    };
    t.compute({ name: "InstanceNormalization", shaderCache: { hint: `${c2}`, inputDependencies: b }, getRunData: () => ({ outputs: [{ dims: o, dataType: e4[0].dataType }], dispatchGroup: { x: Math.ceil(p4 / 64) }, programUniforms: [{ type: 12, data: p4 }, ...W(g, y, g)] }), getShaderSource: _ }, { inputs: [e4[0], m] });
  }, Lg = (t, e4, r) => {
    let n = e4[0].dims, o = n, i = n[0], s = n[n.length - 1], u = k4.sizeFromDimension(n, 1) / s, d = fe(s), c2 = k4.size(o) / d, p4 = [{ type: 12, data: u }, { type: 12, data: Math.floor(s / d) }], m = ["type", "type"], g = false, y = [0, n.length - 1];
    for (let x = 0; x < n.length - 2; x++) g = g || n[x + 1] !== 1, y.push(x + 1);
    g = g && n[n.length - 1] !== 1;
    let b = g ? t.compute(Be(t.inputs[0], y), { inputs: [t.inputs[0]], outputs: [-1] })[0] : t.inputs[0].reshape(Array.from({ length: n.length }, (x, $) => n[y[$]])), _ = Bl(t, b, e4[1], e4[2], i, u, s, r.epsilon), T = (x) => {
      let $ = we(e4[0].dataType), S = d === 1 ? "vec2f" : `mat${d}x2f`, I = (z) => {
        let v = z === 0 ? "x" : "y", R = d === 1 ? "f32" : `vec${d}f`;
        switch (d) {
          case 1:
            return `${$}(${R}(scale.${v}))`;
          case 2:
            return `vec2<${$}>(${R}(scale[0].${v}, scale[1].${v}))`;
          case 4:
            return `vec4<${$}>(${R}(scale[0].${v}, scale[1].${v}, scale[2].${v}, scale[3].${v}))`;
          default:
            throw new Error(`Not supported compoents ${d}`);
        }
      }, E = O("input", e4[0].dataType, e4[0].dims, d), A = U("output", e4[0].dataType, o, d);
      return `
  @group(0) @binding(0) var<storage, read> input : array<${E.type.storage}>;
  @group(0) @binding(1) var<storage, read> scale_input : array<${S}>;
  @group(0) @binding(2) var<storage, read_write> output : array<${A.type.storage}>;
  struct Uniforms {H: u32, C : u32};
  @group(0) @binding(3) var<uniform> uniforms: Uniforms;

  ${x.mainStart()}
    let current_image_number = global_idx / (uniforms.C * uniforms.H);
    let current_channel_number = global_idx % uniforms.C;

    let scale_offset = current_image_number * uniforms.C + current_channel_number;
    let scale = scale_input[scale_offset];
    output[global_idx] = fma(input[global_idx], ${I(0)}, ${I(1)});
  }`;
    };
    t.compute({ name: "InstanceNormalizationNHWC", shaderCache: { hint: `${d}`, inputDependencies: m }, getRunData: () => ({ outputs: [{ dims: o, dataType: e4[0].dataType }], dispatchGroup: { x: Math.ceil(c2 / 64) }, programUniforms: p4 }), getShaderSource: T }, { inputs: [e4[0], _] });
  }, Dl = (t, e4) => {
    e4.format === "NHWC" ? Lg(t, t.inputs, e4) : Vg(t, t.inputs, e4);
  };
});
var Wg;
var Gg;
var Rl;
var Ul = V(() => {
  "use strict";
  J();
  re();
  oe();
  Wg = (t) => {
    if (!t || t.length < 2) throw new Error("layerNorm requires at least 2 inputs.");
  }, Gg = (t, e4, r) => {
    let n = e4.simplified, o = t[0].dims, i = t[1], s = !n && t[2], u = o, d = k4.normalizeAxis(e4.axis, o.length), c2 = k4.sizeToDimension(o, d), p4 = k4.sizeFromDimension(o, d), m = k4.size(i.dims), g = s ? k4.size(s.dims) : 0;
    if (m !== p4 || s && g !== p4) throw new Error(`Size of X.shape()[axis:] == ${p4}.
       Size of scale and bias (if provided) must match this.
       Got scale size of ${m} and bias size of ${g}`);
    let y = [];
    for (let E = 0; E < o.length; ++E) E < d ? y.push(o[E]) : y.push(1);
    let b = fe(p4), _ = ["type", "type"], T = [{ type: 12, data: c2 }, { type: 1, data: p4 }, { type: 12, data: Math.floor(p4 / b) }, { type: 1, data: e4.epsilon }];
    s && _.push("type");
    let x = r > 1, $ = r > 2, S = (E) => {
      let A = we(t[0].dataType), z = [O("x", t[0].dataType, t[0].dims, b), O("scale", i.dataType, i.dims, b)];
      s && z.push(O("bias", s.dataType, s.dims, b)), z.push(U("output", t[0].dataType, u, b)), x && z.push(U("mean_data_output", 1, y)), $ && z.push(U("inv_std_output", 1, y));
      let v = [{ name: "norm_count", type: "u32" }, { name: "norm_size", type: "f32" }, { name: "norm_size_vectorized", type: "u32" }, { name: "epsilon", type: "f32" }];
      return `
  ${E.registerUniforms(v).declareVariables(...z)}
  ${E.mainStart()}
    ${E.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.norm_count")}
    let offset = global_idx * uniforms.norm_size_vectorized;
    var mean_vector = ${ho("f32", b)};
    var mean_square_vector = ${ho("f32", b)};

    for (var h: u32 = 0u; h < uniforms.norm_size_vectorized; h++) {
      let value = ${Dt(A, b, "x[h + offset]")};
      mean_vector += value;
      mean_square_vector += value * value;
    }
    let mean = ${Ze("mean_vector", b)} / uniforms.norm_size;
    let inv_std_dev = inverseSqrt(${Ze("mean_square_vector", b)} / uniforms.norm_size ${n ? "" : "- mean * mean"} + uniforms.epsilon);

    for (var j: u32 = 0; j < uniforms.norm_size_vectorized; j++) {
      let f32input = ${Dt(A, b, "x[j + offset]")};
      let f32scale = ${Dt(A, b, "scale[j]")};
      output[j + offset] = ${z[0].type.value}((f32input ${n ? "" : "- mean"}) * inv_std_dev * f32scale
        ${s ? `+ ${Dt(A, b, "bias[j]")}` : ""}
      );
    }

    ${x ? "mean_data_output[global_idx] = mean" : ""};
    ${$ ? "inv_std_output[global_idx] = inv_std_dev" : ""};
  }`;
    }, I = [{ dims: u, dataType: t[0].dataType }];
    return x && I.push({ dims: y, dataType: 1 }), $ && I.push({ dims: y, dataType: 1 }), { name: "LayerNormalization", shaderCache: { hint: `${b};${r};${n}`, inputDependencies: _ }, getRunData: () => ({ outputs: I, dispatchGroup: { x: Math.ceil(c2 / 64) }, programUniforms: T }), getShaderSource: S };
  }, Rl = (t, e4) => {
    Wg(t.inputs), t.compute(Gg(t.inputs, e4, t.outputCount));
  };
});
var Hg;
var Nl;
var Vl = V(() => {
  "use strict";
  re();
  an();
  sn();
  Hg = (t) => {
    if (!t || t.length !== 2) throw new Error("MatMul requires 2 inputs.");
    if (t[0].dims[t[0].dims.length - 1] !== t[1].dims[t[1].dims.length - 2]) throw new Error("shared dimension does not match.");
  }, Nl = (t) => {
    Hg(t.inputs);
    let e4 = ot.calcShape(t.inputs[0].dims, t.inputs[1].dims, true);
    if (!e4) throw new Error("Can't use matmul on the given tensors");
    let r = e4[e4.length - 1], n = t.inputs[0].dims[t.inputs[0].dims.length - 1];
    if (r < 8 && n < 8) t.compute(on(t.inputs, { activation: "" }, e4));
    else {
      let o = e4[e4.length - 2], i = k4.size(t.inputs[0].dims.slice(0, -2)), s = k4.size(t.inputs[1].dims.slice(0, -2));
      if (i !== 1 && o === 1 && s === 1) {
        let u = t.inputs[0].reshape([1, i, n]), d = t.inputs[1].reshape([1, n, r]), c2 = [1, i, r], p4 = [u, d];
        t.compute(ar(p4, { activation: "" }, e4, c2), { inputs: p4 });
      } else t.compute(ar(t.inputs, { activation: "" }, e4));
    }
  };
});
var Fg;
var qg;
var Kg;
var Ll;
var Wl;
var Gl = V(() => {
  "use strict";
  J();
  re();
  Ce();
  oe();
  Fg = (t, e4) => {
    if (t.length < 3 || t.length > 4) throw new Error("MatMulNBits requires 3 or 4 inputs");
    let r = t[0], n = r.dims.length;
    if (r.dims[n - 1] !== e4.k) throw new Error("The last dim of input shape does not match the k value");
    let o = Math.floor((e4.k + e4.blockSize - 1) / e4.blockSize), i = e4.blockSize / 8 * e4.bits, s = t[1];
    if (!k4.areEqual(s.dims, [e4.n, o, i])) throw new Error("The second inputs must be 3D tensor with shape N X nBlocksPerCol X blobSize");
    let d = t[2].dims;
    if (k4.size(d) !== e4.n * o) throw new Error("scales input size error.");
    if (t.length === 4) {
      let p4 = t[3].dims, m = e4.n * (e4.bits === 8 ? o : Math.floor((o * e4.bits + 7) / 8));
      if (k4.size(p4) !== m) throw new Error("zeroPoints input size error.");
    }
  }, qg = (t, e4) => {
    let r = t[0].dims, n = r.length, o = r[n - 2], i = e4.k, s = e4.n, u = r.slice(0, n - 2), d = k4.size(u), p4 = t[1].dims[2] / 4, m = t[0].dataType, g = fe(e4.k), y = fe(p4), b = fe(s), _ = u.concat([o, s]), T = o > 1 && s / b % 2 === 0 ? 2 : 1, x = k4.size(_) / b / T, $ = 64, S = [], I = [d, o, i / g], E = k4.convertShape(t[1].dims).slice();
    E.splice(-1, 1, p4 / y), S.push(...W(I)), S.push(...W(E)), S.push(...W(t[2].dims)), t.length === 4 && S.push(...W(k4.convertShape(t[3].dims)));
    let A = [d, o, s / b];
    S.push(...W(A));
    let z = (v) => {
      let R = I.length, N = O("a", t[0].dataType, R, g), F = O("b", 12, E.length, y), q = O("scales", t[2].dataType, t[2].dims.length), X = [N, F, q], B = t.length === 4 ? O("zero_points", 12, t[3].dims.length) : void 0;
      B && X.push(B);
      let L = A.length, Q = U("output", t[0].dataType, L, b), Y = we(t[0].dataType), Z = (() => {
        switch (g) {
          case 1:
            return `array<${Y}, 8>`;
          case 2:
            return `mat4x2<${Y}>`;
          case 4:
            return `mat2x4<${Y}>`;
          default:
            throw new Error(`${g}-component is not supported.`);
        }
      })(), te = Math.floor(32 / e4.bits), ae = Math.floor(te / 8), le = () => {
        let M3 = "";
        for (let G = 0; G < ae; G++) {
          let be = G * e4.bits * 4, Ee = be + e4.bits;
          M3 += `
          // reuse a data (pass ${G})
            var input_offset${G > 0 ? G : ""} = ${G === 0 ? N.indicesToOffset(`${N.type.indices}(batch, row, word_offset)`) : "input_offset"};
            var a_data${G > 0 ? G : ""}: ${Z};
            for (var j${G > 0 ? G : ""}: u32 = 0; j${G > 0 ? G : ""} < ${8 / g}; j${G > 0 ? G : ""}++) {
              a_data${G > 0 ? G : ""}[j${G > 0 ? G : ""}] = ${N.getByOffset(`input_offset${G > 0 ? G : ""}`)};
              input_offset${G > 0 ? G : ""}++;
            }
          `;
          for (let $e = 0; $e < b * T; $e++) M3 += `
            b_value = ${y === 1 ? `b${$e}_data` : `b${$e}_data[i]`};
            ${e4.bits === 2 ? `{
              let half_word = b_value >> ${G * 16}u;
              let byte_lo = half_word & 0xFFu;
              let byte_hi = (half_word >> 8u) & 0xFFu;
              let spread_word = (byte_lo & 0xFu) | ((byte_lo >> 4u) << 8u) | ((byte_hi & 0xFu) << 16u) | ((byte_hi >> 4u) << 24u);
              b_value_lower = unpack4xU8(spread_word & b_mask);
              b_value_upper = unpack4xU8((spread_word >> 2u) & b_mask);
            }` : `b_value_lower = unpack4xU8((b_value >> ${be}u) & b_mask);
            b_value_upper = unpack4xU8((b_value >> ${Ee}u) & b_mask);`}
            b_quantized_values = ${Z}(${Array.from({ length: 4 }, (Pe, he) => `${Y}(b_value_lower[${he}]), ${Y}(b_value_upper[${he}])`).join(", ")});
            b_dequantized_values = ${g === 1 ? `${Z}(${Array.from({ length: 8 }, (Pe, he) => `(b_quantized_values[${he}] - ${B ? `zero_point${$e}` : "zero_point"}) * scale${$e}`).join(", ")});` : `(b_quantized_values - ${Z}(${Array(8).fill(`${B ? `zero_point${$e}` : "zero_point"}`).join(",")})) * scale${$e};`};
            workgroup_shared[local_id.x * ${T} + ${Math.floor($e / b)}]${b > 1 ? `[${$e % b}]` : ""} += ${Array.from({ length: 8 / g }, (Pe, he) => `${g === 1 ? `a_data${G > 0 ? G : ""}[${he}] * b_dequantized_values[${he}]` : `dot(a_data${G > 0 ? G : ""}[${he}], b_dequantized_values[${he}])`}`).join(" + ")};
          `;
        }
        return M3;
      }, Me = () => {
        let M3 = `
            var col_index = col * ${b};
            ${B ? `
            let zero_point_values_per_byte: u32 = ${Math.floor(8 / e4.bits)}u;
            let zero_point_bytes_per_col = (nBlocksPerCol + zero_point_values_per_byte - 1u) / zero_point_values_per_byte;
            var zero_point_byte_count: u32;
            var zero_point_word_index: u32;
            var zero_point_byte_offset: u32;
            let zero_point_sub_offset: u32 = block % zero_point_values_per_byte;
            var zero_point_bits_offset: u32;
            var zero_point_word: u32;` : `
            // The default zero point is ${Math.pow(2, e4.bits - 1)} for unsigned ${e4.bits}-bit quantization.
            let zero_point = ${Y}(${Math.pow(2, e4.bits - 1).toFixed(1)});`}
            `;
        for (let G = 0; G < b * T; G++) M3 += `
            let scale${G} = ${q.getByOffset("col_index * nBlocksPerCol + block")};
            ${B ? `
            zero_point_byte_count = col_index * zero_point_bytes_per_col + (block / zero_point_values_per_byte);
            zero_point_word_index = zero_point_byte_count >> 0x2u;
            zero_point_byte_offset = zero_point_byte_count & 0x3u;
            zero_point_bits_offset = (zero_point_byte_offset << 3) + (zero_point_sub_offset * ${e4.bits}u);
            zero_point_word = ${B.getByOffset("zero_point_word_index")} >> zero_point_bits_offset;
            let zero_point${G} = ${Y}((zero_point_word) & ${e4.bits === 2 ? "0x3u" : "0xFu"});` : ""}
            col_index += 1;`;
        return M3;
      }, ve = () => {
        let M3 = `col_index = col * ${b};`;
        for (let G = 0; G < b * T; G++) M3 += `
            let b${G}_data = ${F.getByIndices(`${F.type.indices}(col_index, block, word)`)};
            col_index += 1;`;
        return M3 += `
            var b_value: u32;
            let b_mask: u32 = ${e4.bits === 2 ? "0x03030303u" : "0x0F0F0F0Fu"};
            var b_value_lower: vec4<u32>;
            var b_value_upper: vec4<u32>;
            var b_quantized_values: ${Z};
            var b_dequantized_values: ${Z};`, M3;
      };
      return `
        var<workgroup> workgroup_shared: array<${Q.type.value}, ${T * $}>;
        ${v.declareVariables(...X, Q)}
        ${v.mainStart([$, 1, 1])}
          let output_indices = ${Q.offsetToIndices(`(global_idx / ${$}) * ${T}`)};
          let col = output_indices[2];
          let row = output_indices[1];
          let batch = output_indices[0];
          let nBlocksPerCol = uniforms.b_shape[1];

          for (var block = local_id.x; block < nBlocksPerCol; block += ${$}) {
            //process one block
            var word_offset: u32 = block * ${e4.blockSize / g};
            ${Me()}
            for (var word: u32 = 0; word < ${p4}; word += ${y}) {
              ${ve()}
              for (var i: u32 = 0; i < ${y}; i++) {
                ${le()}
                word_offset += ${te / g};
              }
            }
          }
          workgroupBarrier();

          if (local_id.x < ${T}) {
            var output_value: ${Q.type.value} = ${Q.type.value}(0);
            var workgroup_shared_offset: u32 = local_id.x;
            for (var b: u32 = 0u; b < ${$}u; b++) {
              output_value += workgroup_shared[workgroup_shared_offset];
              workgroup_shared_offset += ${T};
            }
            ${Q.setByIndices(`${Q.type.indices}(batch, row, col + local_id.x)`, "output_value")};
          }
        }`;
    };
    return { name: "MatMulNBits", shaderCache: { hint: `${e4.blockSize};${e4.bits};${g};${y};${b};${T};${$}`, inputDependencies: Array(t.length).fill("rank") }, getRunData: () => ({ outputs: [{ dims: _, dataType: m }], dispatchGroup: { x }, programUniforms: S }), getShaderSource: z };
  }, Kg = (t, e4) => {
    let r = t[0].dims, n = r.length, o = r[n - 2], i = e4.k, s = e4.n, u = r.slice(0, n - 2), d = k4.size(u), p4 = t[1].dims[2] / 4, m = t[0].dataType, g = fe(e4.k), y = fe(p4), b = u.concat([o, s]), _ = 128, T = s % 8 === 0 ? 8 : s % 4 === 0 ? 4 : 1, x = _ / T, $ = Math.floor(32 / e4.bits), S = x * y * $, I = S / g, E = S / e4.blockSize, A = k4.size(b) / T, z = [], v = [d, o, i / g], R = k4.convertShape(t[1].dims).slice();
    R.splice(-1, 1, p4 / y), z.push(...W(v)), z.push(...W(R)), z.push(...W(t[2].dims)), t.length === 4 && z.push(...W(k4.convertShape(t[3].dims)));
    let N = [d, o, s];
    z.push(...W(N));
    let F = (q) => {
      let X = v.length, B = O("a", t[0].dataType, X, g), L = O("b", 12, R.length, y), Q = O("scales", t[2].dataType, t[2].dims.length), Y = [B, L, Q], Z = t.length === 4 ? O("zero_points", 12, t[3].dims.length) : void 0;
      Z && Y.push(Z);
      let te = N.length, ae = U("output", t[0].dataType, te), le = we(t[0].dataType), Me = () => {
        switch (g) {
          case 1:
            return `
          let a_data0 = vec4<${le}>(sub_a[word_offset], sub_a[word_offset + 1], sub_a[word_offset + 2], sub_a[word_offset + 3]);
          let a_data1 = vec4<${le}>(sub_a[word_offset + 4], sub_a[word_offset + 5], sub_a[word_offset + 6], sub_a[word_offset + 7]);`;
          case 2:
            return `
          let a_data0 = vec4<${le}>(sub_a[word_offset], sub_a[word_offset + 1]);
          let a_data1 = vec4<${le}>(sub_a[word_offset + 2], sub_a[word_offset + 3]);`;
          case 4:
            return `
          let a_data0 = sub_a[word_offset];
          let a_data1 = sub_a[word_offset + 1];`;
          default:
            throw new Error(`${g}-component is not supported.`);
        }
      };
      return `
        var<workgroup> sub_a: array<${B.type.value}, ${I}>;
        var<workgroup> inter_results: array<array<${ae.type.value}, ${x}>, ${T}>;
        ${q.declareVariables(...Y, ae)}
        ${q.mainStart([x, T, 1])}
          let output_indices = ${ae.offsetToIndices(`workgroup_index * ${T}`)};
          let col = output_indices[2];
          let row = output_indices[1];
          let batch = output_indices[0];
          let n_blocks_per_col = uniforms.b_shape[1];
          let num_tiles =  (n_blocks_per_col - 1) / ${E} + 1;

          // Loop over shared dimension.
          for (var tile: u32 = 0; tile < num_tiles; tile += 1) {
            let a_col_start = tile * ${I};
            // load one tile A data into shared memory.
            for (var a_offset = local_idx; a_offset < ${I}; a_offset += ${_})
            {
              let a_col = a_col_start + a_offset;
              if (a_col < uniforms.a_shape[2])
              {
                sub_a[a_offset] = ${B.getByIndices(`${B.type.indices}(batch, row, a_col)`)};
              } else {
                sub_a[a_offset] = ${B.type.value}(0);
              }
            }
            workgroupBarrier();

            // each thread process one block
            let b_row = col + local_id.y;
            let block = tile * ${E} + local_id.x;
            ${Z ? `
            let zero_point_values_per_byte: u32 = ${Math.floor(8 / e4.bits)}u;
            let zero_point_bytes_per_col = (n_blocks_per_col + zero_point_values_per_byte - 1u) / zero_point_values_per_byte;
            let zero_point_byte_count = b_row * zero_point_bytes_per_col + (block / zero_point_values_per_byte);
            let zero_point_word_index = zero_point_byte_count >> 0x2u;
            let zero_point_byte_offset = zero_point_byte_count & 0x3u;
            let zero_point_sub_offset: u32 = block % zero_point_values_per_byte;
            let zero_point_bits_offset = (zero_point_byte_offset << 3) + (zero_point_sub_offset * ${e4.bits}u);
            let zero_point_word = ${Z.getByOffset("zero_point_word_index")} >> zero_point_bits_offset;
            let zero_point = ${le}((zero_point_word) & ${e4.bits === 2 ? "0x3u" : "0xFu"});` : `
            // The default zero point is ${Math.pow(2, e4.bits - 1)} for unsigned ${e4.bits}-bit quantization.
            let zero_point = ${le}(${Math.pow(2, e4.bits - 1).toFixed(1)});`}
            let scale = ${Q.getByOffset("b_row * n_blocks_per_col + block")};
            let b_data = ${L.getByIndices(`${L.type.indices}(b_row, block, 0)`)};
            var word_offset = local_id.x * ${e4.blockSize / g};
            for (var i: u32 = 0; i < ${y}; i++) {
              let b_value = ${y === 1 ? "b_data" : "b_data[i]"};
              ${(() => {
        let ve = Math.floor($ / 8), M3 = "";
        for (let G = 0; G < ve; G++) {
          let be = G * e4.bits * 4, Ee = be + e4.bits;
          M3 += `
              ${Me()}
              {${e4.bits === 2 ? `
                let half_word = b_value >> ${G * 16}u;
                let byte_lo = half_word & 0xFFu;
                let byte_hi = (half_word >> 8u) & 0xFFu;
                let spread_word = (byte_lo & 0xFu) | ((byte_lo >> 4u) << 8u) | ((byte_hi & 0xFu) << 16u) | ((byte_hi >> 4u) << 24u);
                let b_value_lower = unpack4xU8(spread_word & 0x03030303u);
                let b_value_upper = unpack4xU8((spread_word >> 2u) & 0x03030303u);` : `
                let b_value_lower = unpack4xU8((b_value >> ${be}u) & 0x0F0F0F0Fu);
                let b_value_upper = unpack4xU8((b_value >> ${Ee}u) & 0x0F0F0F0Fu);`}
                let b_quantized_values = mat2x4<${le}>(${Array.from({ length: 4 }, ($e, Pe) => `${le}(b_value_lower[${Pe}]), ${le}(b_value_upper[${Pe}])`).join(", ")});
                let b_dequantized_values = (b_quantized_values - mat2x4<${le}>(${Array(8).fill("zero_point").join(",")})) * scale;
                inter_results[local_id.y][local_id.x] += ${Array.from({ length: 2 }, ($e, Pe) => `${`dot(a_data${Pe}, b_dequantized_values[${Pe}])`}`).join(" + ")};
              }
              word_offset += ${8 / g};`;
        }
        return M3;
      })()}
            }
            workgroupBarrier();
          }

          if (local_idx < ${T}) {
            var output_value: ${ae.type.value} = ${ae.type.value}(0);
            for (var b = 0u; b < ${x}; b++) {
              output_value += inter_results[local_idx][b];
            }
            if (col + local_idx < uniforms.output_shape[2])
            {
              ${ae.setByIndices(`${ae.type.indices}(batch, row, col + local_idx)`, "output_value")}
            }
          }
        }`;
    };
    return { name: "BlockwiseMatMulNBits32", shaderCache: { hint: `${e4.blockSize};${g};${y};${x};${T}`, inputDependencies: Array(t.length).fill("rank") }, getRunData: () => ({ outputs: [{ dims: b, dataType: m }], dispatchGroup: { x: A }, programUniforms: z }), getShaderSource: F };
  }, Ll = (t, e4) => {
    Fg(t.inputs, e4), e4.blockSize === 32 && t.adapterInfo.isVendor("intel") && t.adapterInfo.isArchitecture("gen-12lp") ? t.compute(Kg(t.inputs, e4)) : t.compute(qg(t.inputs, e4));
  }, Wl = (t) => ee(t);
});
var jg;
var Zg;
var Qg;
var Yg;
var Xg;
var Jg;
var eb;
var tb;
var Hl;
var Fl = V(() => {
  "use strict";
  J();
  re();
  oe();
  jg = (t) => {
    if (!t || t.length < 1) throw new Error("Too few inputs");
    if (t[0].dataType !== 1 && t[0].dataType !== 10) throw new Error("Input type must be float or float16.");
    if (t.length >= 2) {
      let e4 = t[0].dims.length * 2 === t[1].dims[0];
      if (t.length === 4 && (e4 = t[3].dims[0] * 2 === t[1].dims[0]), !e4) throw new Error("The pads should be a 1D tensor of shape [2 * input_rank] or [2 * num_axes].");
    }
  }, Zg = (t, e4, r) => {
    let n = "";
    for (let o = e4 - 1; o >= 0; --o) n += `
            k = i32(${t.indicesGet("indices", o)}) - ${j("uniforms.pads", o, r)};
            if (k < 0) {
              break;
            }
            if (k >= i32(${j("uniforms.x_shape", o, e4)})) {
              break;
            }
            offset += k * i32(${j("uniforms.x_strides", o, e4)});
        `;
    return `
          value = ${t.type.value}(uniforms.constant_value);
          for (var i = 0; i < 1; i++) {
            var offset = 0;
            var k = 0;
            ${n}
            value = x[offset];
          }
      `;
  }, Qg = (t, e4, r) => {
    let n = "";
    for (let o = e4 - 1; o >= 0; --o) n += `
                k = i32(${t.indicesGet("indices", o)}) - ${j("uniforms.pads", o, r)};
                if (k < 0) {
                  k = -k;
                }
                {
                  let _2n_1 = 2 * (i32(${j("uniforms.x_shape", o, e4)}) - 1);
                  k = k % _2n_1;
                  if(k >= i32(${j("uniforms.x_shape", o, e4)})) {
                    k = _2n_1 - k;
                  }
                }
                offset += k * i32(${j("uniforms.x_strides", o, e4)});
            `;
    return `
              var offset = 0;
              var k = 0;
              ${n}
              value = x[offset];
          `;
  }, Yg = (t, e4, r) => {
    let n = "";
    for (let o = e4 - 1; o >= 0; --o) n += `
                k = i32(${t.indicesGet("indices", o)}) - ${j("uniforms.pads", o, r)};
                if (k < 0) {
                  k = 0;
                }
                if (k >= i32(${j("uniforms.x_shape", o, e4)})) {
                  k = i32(${j("uniforms.x_shape", o, e4)}) - 1;
                }
                offset += k * i32(${j("uniforms.x_strides", o, e4)});
            `;
    return `
              var offset = 0;
              var k = 0;
              ${n}
              value = x[offset];
          `;
  }, Xg = (t, e4, r) => {
    let n = "";
    for (let o = e4 - 1; o >= 0; --o) n += `
                k = i32(${t.indicesGet("indices", o)}) - ${j("uniforms.pads", o, r)};
                if (k < 0)  {
                  k += i32(${j("uniforms.x_shape", o, e4)}]);
                }
                if (k >= i32(${j("uniforms.x_shape", o, e4)})) {
                  k -= i32(${j("uniforms.x_shape", o, e4)});
                }
                offset += k * i32(${j("uniforms.x_strides", o, e4)});
            `;
    return `
              var offset = 0;
              var k = 0;
              ${n}
              value = x[offset];
          `;
  }, Jg = (t, e4, r) => {
    switch (r.mode) {
      case 0:
        return Zg(t, e4, r.pads.length);
      case 1:
        return Qg(t, e4, r.pads.length);
      case 2:
        return Yg(t, e4, r.pads.length);
      case 3:
        return Xg(t, e4, r.pads.length);
      default:
        throw new Error("Invalid mode");
    }
  }, eb = (t, e4) => {
    let r = k4.padShape(t[0].dims.slice(), e4.pads), n = t[0].dims, o = k4.size(r), i = [{ type: 12, data: o }, { type: 6, data: e4.pads }], s = t.length >= 3 && t[2].data;
    e4.mode === 0 && i.push({ type: s ? t[2].dataType : 1, data: e4.value }), i.push(...W(t[0].dims, r));
    let u = ["rank"], d = (c2) => {
      let p4 = U("output", t[0].dataType, r.length), m = O("x", t[0].dataType, n.length), g = m.type.value, y = Jg(p4, n.length, e4), b = [{ name: "output_size", type: "u32" }, { name: "pads", type: "i32", length: e4.pads.length }];
      return e4.mode === 0 && b.push({ name: "constant_value", type: s ? g : "f32" }), `
            ${c2.registerUniforms(b).declareVariables(m, p4)}
            ${c2.mainStart()}
            ${c2.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}

            let indices = ${p4.offsetToIndices("global_idx")};

            var value = ${g}(0);
            ${y}
            output[global_idx] = value;
        }`;
    };
    return { name: "Pad", shaderCache: { hint: `${e4.mode}${s}`, inputDependencies: u }, getRunData: () => ({ outputs: [{ dims: r, dataType: t[0].dataType }], dispatchGroup: { x: Math.ceil(k4.size(r) / 64) }, programUniforms: i }), getShaderSource: d };
  }, tb = (t, e4) => {
    if (t.length > 1) {
      let r = t[1].getBigInt64Array(), n = t.length >= 3 && t[2].data ? t[2].dataType === 10 ? t[2].getUint16Array()[0] : t[2].getFloat32Array()[0] : 0, o = t[0].dims.length, i = new Int32Array(2 * o).fill(0);
      if (t.length >= 4) {
        let u = t[3].getBigInt64Array();
        for (let d = 0; d < u.length; d++) i[Number(u[d])] = Number(r[d]), i[Number(u[d]) + o] = Number(r[d + u.length]);
      } else r.forEach((u, d) => i[Number(d)] = Number(u));
      let s = [];
      return i.forEach((u) => s.push(u)), { mode: e4.mode, value: n, pads: s };
    } else return e4;
  }, Hl = (t, e4) => {
    jg(t.inputs);
    let r = tb(t.inputs, e4);
    t.compute(eb(t.inputs, r), { inputs: [0] });
  };
});
var cn;
var ql;
var Kl;
var jl;
var Zl;
var rb;
var nb;
var Ql;
var Yl;
var Xl;
var Jl;
var ec;
var tc;
var rc;
var nc;
var oc;
var ic;
var ac;
var sc;
var uc = V(() => {
  "use strict";
  Le();
  J();
  re();
  oe();
  cn = (t) => {
    if (_e.webgpu.validateInputContent && (!t || t.length !== 1)) throw new Error("Pool ops requires 1 input.");
  }, ql = (t, e4, r) => {
    let n = e4.format === "NHWC", o = t.dims.slice();
    n && o.splice(1, 0, o.pop());
    let i = Object.hasOwnProperty.call(e4, "dilations"), s = e4.kernelShape.slice(), u = e4.strides.slice(), d = i ? e4.dilations.slice() : [], c2 = e4.pads.slice();
    zt.adjustPoolAttributes(r, o, s, u, d, c2);
    let p4 = zt.computePoolOutputShape(r, o, u, d, s, c2, e4.autoPad), m = Object.assign({}, e4);
    i ? Object.assign(m, { kernelShape: s, strides: u, pads: c2, dilations: d, cacheKey: e4.cacheKey }) : Object.assign(m, { kernelShape: s, strides: u, pads: c2, cacheKey: e4.cacheKey });
    let g = p4.slice();
    return g.push(g.splice(1, 1)[0]), [m, n ? g : p4];
  }, Kl = (t, e4) => {
    let r = e4.format === "NHWC", n = k4.size(t), o = k4.size(e4.kernelShape), i = [{ type: 12, data: n }, { type: 12, data: o }], s = [{ name: "outputSize", type: "u32" }, { name: "kernelSize", type: "u32" }];
    if (e4.kernelShape.length <= 2) {
      let u = e4.kernelShape[e4.kernelShape.length - 1], d = e4.strides[e4.strides.length - 1], c2 = e4.pads[e4.pads.length / 2 - 1], p4 = e4.pads[e4.pads.length - 1], m = !!(c2 + p4);
      i.push({ type: 12, data: u }, { type: 12, data: d }, { type: 12, data: c2 }, { type: 12, data: p4 }), s.push({ name: "kw", type: "u32" }, { name: "sw", type: "u32" }, { name: "pwStart", type: "u32" }, { name: "pwEnd", type: "u32" });
      let g = false;
      if (e4.kernelShape.length === 2) {
        let y = e4.kernelShape[e4.kernelShape.length - 2], b = e4.strides[e4.strides.length - 2], _ = e4.pads[e4.pads.length / 2 - 2], T = e4.pads[e4.pads.length - 2];
        g = !!(_ + T), i.push({ type: 12, data: y }, { type: 12, data: b }, { type: 12, data: _ }, { type: 12, data: T }), s.push({ name: "kh", type: "u32" }, { name: "sh", type: "u32" }, { name: "phStart", type: "u32" }, { name: "phEnd", type: "u32" });
      }
      return [i, s, true, m, g];
    } else {
      if (r) throw new Error("Pooling with kernelShape.length > 2 is not supported for NHWC format.");
      let u = k4.computeStrides(e4.kernelShape);
      i.push({ type: 12, data: u }, { type: 12, data: e4.pads }, { type: 12, data: e4.strides }), s.push({ name: "kernelStrides", type: "u32", length: u.length }, { name: "pads", type: "u32", length: e4.pads.length }, { name: "strides", type: "u32", length: e4.strides.length });
      let d = e4.pads.reduce((c2, p4) => c2 + p4);
      return [i, s, !!d, false, false];
    }
  }, jl = (t, e4, r, n, o, i, s, u, d, c2, p4, m) => {
    let g = o.format === "NHWC", y = e4.type.value, b = U("output", e4.type.tensor, n);
    if (o.kernelShape.length <= 2) {
      let _ = "", T = "", x = "", $ = r - (g ? 2 : 1);
      if (p4 ? _ = `
                for (var i: u32 = 0u; i < uniforms.kw; i++) {
                  xIndices[${$}] = indices[${$}] * uniforms.sw - uniforms.pwStart + i;
                  if (xIndices[${$}] < 0 || xIndices[${$}]
                      >= uniforms.x_shape[${$}]) {
                    pad++;
                    continue;
                  }
                  let x_val = x[${e4.indicesToOffset("xIndices")}];
                  ${i}
                }` : _ = `
                for (var i: u32 = 0u; i < uniforms.kw; i++) {
                  xIndices[${$}] = indices[${$}] * uniforms.sw - uniforms.pwStart + i;
                  let x_val = x[${e4.indicesToOffset("xIndices")}];
                  ${i}
                }`, o.kernelShape.length === 2) {
        let I = r - (g ? 3 : 2);
        m ? T = `
                for (var j: u32 = 0u; j < uniforms.kh; j++) {
                  xIndices[${I}] = indices[${I}] * uniforms.sh - uniforms.phStart + j;
                  if (xIndices[${I}] < 0 || xIndices[${I}] >= uniforms.x_shape[${I}]) {
                    pad += i32(uniforms.kw);
                    continue;
                  }
              ` : T = `
                for (var j: u32 = 0u; j < uniforms.kh; j++) {
                  xIndices[${I}] = indices[${I}] * uniforms.sh - uniforms.phStart + j;
                `, x = `
              }
            `;
      }
      return `
            ${t.registerUniforms(d).declareVariables(e4, b)}

            ${t.mainStart()}
              ${t.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}

              let indices = ${b.offsetToIndices("global_idx")};
              var xIndices = ${b.offsetToIndices("global_idx")};

              var value = ${y}(${u});
              var pad = 0;
              ${T}
              ${_}
              ${x}
              ${s}

              output[global_idx] = value;
            }`;
    } else {
      if (g) throw new Error("Pooling with kernelShape.length > 2 is not supported for NHWC format.");
      let _ = o.kernelShape.length, T = o.pads.length, x = "";
      return c2 ? x = `
                if (xIndices[j] >= uniforms.x_shape[j]) {
                  pad++;
                  isPad = true;
                  break;
                }
              }
              if (!isPad) {
                let x_val = x[${e4.indicesToOffset("xIndices")}];
                ${i}
              }` : x = `
              }
              let x_val = x[${e4.indicesToOffset("xIndices")}];
              ${i}
            `, `
            ${t.registerUniforms(d).declareVariables(e4, b)}

            ${t.mainStart()}
              ${t.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
              let indices = ${b.offsetToIndices("global_idx")};
              var xIndices = ${b.offsetToIndices("global_idx")};

              var offsets: array<u32, ${_}>;

              var value = ${y}(${u});
              var pad = 0;
              var isPad = false;

              for (var i: u32 = 0u; i < uniforms.kernelSize; i++) {
                var offset = i;
                for (var j = 0u; j < ${_ - 1}u; j++) {
                  offsets[j] = offset / ${j("uniforms.kernelStrides", "j", _)};
                  offset -= offsets[j] * ${j("uniforms.kernelStrides", "j", _)};
                }
                offsets[${_ - 1}] = offset;

                isPad = false;
                for (var j = ${r - _}u; j < ${r}u; j++) {
                  xIndices[j] = indices[j] * ${j("uniforms.strides", `j - ${r - _}u`, _)}
                    + offsets[j - ${r - _}u] - ${j("uniforms.pads", "j - 2u", T)};
                  ${x}
              }
              ${s}

              output[global_idx] = value;
            }`;
    }
  }, Zl = (t) => `${t.format};${t.ceilMode};${t.autoPad};${t.kernelShape.length}`, rb = (t) => `${Zl(t)};${t.countIncludePad}`, nb = (t) => `${Zl(t)};${t.storageOrder};${t.dilations}`, Ql = (t) => ({ format: t.format, autoPad: ["NOTSET", "VALID", "SAME_UPPER", "SAME_LOWER"][t.auto_pad], ceilMode: t.ceil_mode, kernelShape: t.kernel_shape, strides: t.strides, pads: t.pads }), Yl = (t, e4, r, n) => {
    let [o, i] = ql(e4, n, r), s = O("x", e4.dataType, e4.dims.length), u = s.type.value, d = "value += x_val;", c2 = "";
    o.countIncludePad ? c2 += `value /= ${u}(uniforms.kernelSize);` : c2 += `value /= ${u}(i32(uniforms.kernelSize) - pad);`;
    let [p4, m, g, y, b] = Kl(i, o);
    p4.push(...W(e4.dims, i));
    let _ = ["rank"];
    return { name: t, shaderCache: { hint: `${n.cacheKey};${g};${y};${b}`, inputDependencies: _ }, getRunData: () => ({ outputs: [{ dims: i, dataType: e4.dataType }], dispatchGroup: { x: Math.ceil(k4.size(i) / 64) }, programUniforms: p4 }), getShaderSource: (T) => jl(T, s, e4.dims.length, i.length, o, d, c2, 0, m, g, y, b) };
  }, Xl = (t) => {
    let e4 = t.count_include_pad !== 0, r = Ql(t);
    if (r.ceilMode !== 0) throw new Error("using ceil() in shape computation is not yet supported for AveragePool");
    let n = { countIncludePad: e4, ...r, cacheKey: "" };
    return { ...n, cacheKey: rb(n) };
  }, Jl = (t, e4) => {
    cn(t.inputs), t.compute(Yl("AveragePool", t.inputs[0], false, e4));
  }, ec = { autoPad: "", ceilMode: 0, countIncludePad: false, kernelShape: [], strides: [], pads: [], storageOrder: 0, dilations: [] }, tc = (t) => {
    let e4 = t.format;
    return { format: e4, ...ec, cacheKey: e4 };
  }, rc = (t, e4) => {
    cn(t.inputs), t.compute(Yl("GlobalAveragePool", t.inputs[0], true, e4));
  }, nc = (t, e4, r, n) => {
    let [o, i] = ql(e4, n, r), s = `
      value = max(x_val, value);
    `, u = "", d = O("x", e4.dataType, e4.dims.length), c2 = ["rank"], [p4, m, g, y, b] = Kl(i, o);
    return p4.push(...W(e4.dims, i)), { name: t, shaderCache: { hint: `${n.cacheKey};${g};${y};${b}`, inputDependencies: c2 }, getRunData: () => ({ outputs: [{ dims: i, dataType: e4.dataType }], dispatchGroup: { x: Math.ceil(k4.size(i) / 64) }, programUniforms: p4 }), getShaderSource: (_) => jl(_, d, e4.dims.length, i.length, o, s, u, e4.dataType === 10 ? -65504 : -1e5, m, g, y, b) };
  }, oc = (t, e4) => {
    cn(t.inputs), t.compute(nc("MaxPool", t.inputs[0], false, e4));
  }, ic = (t) => {
    let e4 = t.storage_order, r = t.dilations, n = Ql(t);
    if (e4 !== 0) throw new Error("column major storage order is not yet supported for MaxPool");
    if (n.ceilMode !== 0) throw new Error("using ceil() in shape computation is not yet supported for MaxPool");
    let o = { storageOrder: e4, dilations: r, ...n, cacheKey: "" };
    return { ...o, cacheKey: nb(o) };
  }, ac = (t) => {
    let e4 = t.format;
    return { format: e4, ...ec, cacheKey: e4 };
  }, sc = (t, e4) => {
    cn(t.inputs), t.compute(nc("GlobalMaxPool", t.inputs[0], true, e4));
  };
});
var ib;
var ab;
var dc;
var lc;
var cc = V(() => {
  "use strict";
  J();
  re();
  Ce();
  oe();
  ib = (t, e4) => {
    if (t.length < 2 || t.length > 3) throw new Error("DequantizeLinear requires 2 or 3 inputs.");
    if (t.length === 3 && t[1].dims === t[2].dims) throw new Error("x-scale and x-zero-point must have the same shape.");
    if (t.length === 3 && t[0].dataType !== t[2].dataType) throw new Error("x and x-zero-point must have the same data type.");
    if (t[1].dims.length !== 0 && t[1].dims.length !== 1 && t[1].dims.length !== t[0].dims.length) throw new Error("scale input must be a scalar, a 1D tensor, or have the same rank as the input tensor.");
    if (t.length > 2) {
      if (t[0].dataType !== t[2].dataType) throw new Error("x and x-zero-point must have the same data type.");
      if (t[1].dims.length !== t[2].dims.length) throw new Error("scale and zero-point inputs must have the same rank.");
      if (!t[1].dims.map((r, n) => r === t[2].dims[n]).reduce((r, n) => r && n, true)) throw new Error("scale and zero-point inputs must have the same shape.");
    }
    if (e4.blockSize > 0) {
      if (t[1].dims.length === 0 || t[1].dims.length === 1 && t[1].dims[0] === 1) throw new Error("blockSize must be set only for block quantization.");
      if (!t[1].dims.map((o, i) => i === e4.axis || o === t[0].dims[i]).reduce((o, i) => o && i, true)) throw new Error("For block qunatization, scale input shape to match the input shape except for the axis");
      if (t[1].dims.length !== t[0].dims.length) throw new Error("For block qunatization the scale input rank must be the same as the x rank.");
      let r = t[0].dims[e4.axis], n = t[1].dims[e4.axis];
      if (e4.blockSize < Math.ceil(r / n) || e4.blockSize > Math.ceil(r / (n - 1) - 1)) throw new Error("blockSize must be with in the range [ceil(dI / Si), ceil(dI / (Si - 1) - 1)].");
    }
  }, ab = (t, e4) => {
    let r = k4.normalizeAxis(e4.axis, t[0].dims.length), n = t[0].dataType, o = n === 3, i = t[0].dims, s = t[1].dataType, u = k4.size(i), d = n === 3 || n === 2, c2 = d ? [Math.ceil(k4.size(t[0].dims) / 4)] : t[0].dims, p4 = t[1].dims, m = t.length > 2 ? t[2] : void 0, g = m ? d ? [Math.ceil(k4.size(m.dims) / 4)] : m.dims : void 0, y = p4.length === 0 || p4.length === 1 && p4[0] === 1, b = y === false && p4.length === 1, _ = fe(u), T = y && (!d || _ === 4), x = T ? _ : 1, $ = T && !d ? _ : 1, S = O("input", d ? 12 : n, c2.length, $), I = O("scale", s, p4.length), E = m ? O("zero_point", d ? 12 : n, g.length) : void 0, A = U("output", s, i.length, x), z = [S, I];
    E && z.push(E);
    let v = [c2, p4];
    m && v.push(g);
    let R = [{ type: 12, data: u / x }, { type: 12, data: r }, { type: 12, data: e4.blockSize }, ...W(...v, i)], N = (F) => {
      let q = [{ name: "output_size", type: "u32" }, { name: "axis", type: "u32" }, { name: "block_size", type: "u32" }];
      return `
      ${F.registerUniforms(q).declareVariables(...z, A)}
      ${F.mainStart()}
          ${F.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
          let output_indices = ${A.offsetToIndices("global_idx")};

          // Set input x
          ${d ? `
            let input = ${S.getByOffset("global_idx / 4")};
            let x_vec = ${o ? "unpack4xI8(input)" : "unpack4xU8(input)"};
            let x_value = ${x === 1 ? "x_vec[global_idx % 4]" : "x_vec"};` : `let x_value = ${S.getByOffset("global_idx")};`};

          // Set scale input
          ${y ? `let scale_value= ${I.getByOffset("0")}` : b ? `
            let scale_index = ${A.indicesGet("output_indices", "uniforms.axis")};
            let scale_value= ${I.getByOffset("scale_index")};` : `
            var scale_indices: ${I.type.indices} = output_indices;
            let index = ${I.indicesGet("scale_indices", "uniforms.axis")} / uniforms.block_size;
            ${I.indicesSet("scale_indices", "uniforms.axis", "index")};
            let scale_value= ${I.getByIndices("scale_indices")};`};

          // Set zero-point input
          ${E ? y ? d ? `
                let zero_point_input = ${E.getByOffset("0")};
                let zero_point_vec =  ${o ? "unpack4xI8(zero_point_input)" : "unpack4xU8(zero_point_input)"};
                let zero_point_value= zero_point_vec[0]` : `let zero_point_value = ${E.getByOffset("0")}` : b ? d ? `
                let zero_point_index = ${A.indicesGet("output_indices", "uniforms.axis")};
                let zero_point_input = ${E.getByOffset("zero_point_index / 4")};
                let zero_point_vec =  ${o ? "unpack4xI8(zero_point_input)" : "unpack4xU8(zero_point_input)"};
                let zero_point_value = zero_point_vec[zero_point_index % 4]` : `
                let zero_point_index = ${A.indicesGet("output_indices", "uniforms.axis")};
                let zero_point_value = ${E.getByOffset("zero_point_index")};` : d ? `
                let zero_point_offset = ${I.indicesToOffset("scale_indices")};
                let zero_point_input = ${E.getByOffset("zero_point_offset / 4")};
                let zero_point_vec = ${o ? "unpack4xI8(zero_point_input)" : "unpack4xU8(zero_point_input)"};
                let zero_point_value = zero_point_vec[zero_point_offset % 4];` : `let zero_point_value = ${E.getByIndices("scale_indices")};` : `let zero_point_value = ${d ? o ? "i32" : "u32" : S.type.value}(0);`};
      // Compute and write output
      ${A.setByOffset("global_idx", `${A.type.value}(x_value - zero_point_value) * scale_value`)};
      }`;
    };
    return { name: "DequantizeLinear", shaderCache: { hint: e4.cacheKey, inputDependencies: E ? ["rank", "rank", "rank"] : ["rank", "rank"] }, getShaderSource: N, getRunData: () => ({ outputs: [{ dims: i, dataType: s }], dispatchGroup: { x: Math.ceil(u / x / 64), y: 1, z: 1 }, programUniforms: R }) };
  }, dc = (t, e4) => {
    ib(t.inputs, e4), t.compute(ab(t.inputs, e4));
  }, lc = (t) => ee({ axis: t.axis, blockSize: t.blockSize });
});
var sb;
var ub;
var pc;
var mc = V(() => {
  "use strict";
  Le();
  J();
  oe();
  sb = (t, e4, r) => {
    let n = t === e4, o = t < e4 && r < 0, i = t > e4 && r > 0;
    if (n || o || i) throw new Error("Range these inputs' contents are invalid.");
  }, ub = (t, e4, r, n) => {
    let o = Math.abs(Math.ceil((e4 - t) / r)), i = [o], s = o, u = [{ type: 12, data: s }, { type: n, data: t }, { type: n, data: r }, ...W(i)], d = (c2) => {
      let p4 = U("output", n, i.length), m = p4.type.value, g = [{ name: "outputSize", type: "u32" }, { name: "start", type: m }, { name: "delta", type: m }];
      return `
        ${c2.registerUniforms(g).declareVariables(p4)}
        ${c2.mainStart()}
        ${c2.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
        output[global_idx] = uniforms.start + ${m}(global_idx) * uniforms.delta;
      }`;
    };
    return { name: "Range", shaderCache: { hint: `${n}` }, getShaderSource: d, getRunData: () => ({ outputs: [{ dims: i, dataType: n }], dispatchGroup: { x: Math.ceil(s / 64) }, programUniforms: u }) };
  }, pc = (t) => {
    let e4 = 0, r = 0, n = 0;
    t.inputs[0].dataType === 6 ? (e4 = t.inputs[0].getInt32Array()[0], r = t.inputs[1].getInt32Array()[0], n = t.inputs[2].getInt32Array()[0]) : t.inputs[0].dataType === 1 && (e4 = t.inputs[0].getFloat32Array()[0], r = t.inputs[1].getFloat32Array()[0], n = t.inputs[2].getFloat32Array()[0]), _e.webgpu.validateInputContent && sb(e4, r, n), t.compute(ub(e4, r, n, t.inputs[0].dataType), { inputs: [] });
  };
});
var db;
var lb;
var fc;
var hc;
var gc = V(() => {
  "use strict";
  J();
  re();
  Ce();
  oe();
  db = (t, e4, r, n) => {
    if (t !== "none" && n !== "i32" && n !== "u32" && n !== "f32") throw new Error(`Input ${n} is not supported with reduction ${t}.`);
    let o = `{
                var oldValue = 0;
                loop {
                  let newValueF32 =`, i = `;
                  let newValue = bitcast<i32>(newValueF32);
                  let res = atomicCompareExchangeWeak(&${e4}, oldValue, newValue);
                  if res.exchanged {
                    break;
                  }
                  oldValue = res.old_value;
                }
              }`;
    switch (t) {
      case "none":
        return `${e4}=${r};`;
      case "add":
        return n === "i32" || n === "u32" ? `atomicAdd(&${e4}, bitcast<${n}>(${r}));` : `
              ${o}bitcast<${n}>(oldValue) + (${r})${i}`;
      case "max":
        return n === "i32" || n === "u32" ? `atomicMax(&${e4}, bitcast<${n}>(${r}));` : `
                ${o}max(bitcast<f32>(oldValue), (${r}))${i}`;
      case "min":
        return n === "i32" || n === "u32" ? `atomicMin(&${e4}, bitcast<${n}>(${r}));` : `${o}min(bitcast<${n}>(oldValue), (${r}))${i}`;
      case "mul":
        return `${o}(bitcast<${n}>(oldValue) * (${r}))${i}`;
      default:
        throw new Error(`Reduction ${t} is not supported.`);
    }
  }, lb = (t, e4) => {
    let r = t[0].dims, n = t[1].dims, o = r, i = 1, s = Math.ceil(k4.sizeToDimension(n, n.length - 1) / i), u = n[n.length - 1], d = k4.sizeFromDimension(r, u), c2 = [{ type: 12, data: s }, { type: 12, data: u }, { type: 12, data: d }, ...W(t[1].dims, t[2].dims, o)], p4 = (m) => {
      let g = O("indices", t[1].dataType, t[1].dims.length), y = O("updates", t[2].dataType, t[2].dims.length, i), b = e4.reduction !== "none" && e4.reduction !== "" ? Ws("output", t[0].dataType, o.length) : U("output", t[0].dataType, o.length, i);
      return `
      ${m.registerUniform("output_size", "u32").registerUniform("last_index_dimension", "u32").registerUniform("num_updates_elements", "u32").declareVariables(g, y, b)}
      ${m.mainStart()}
        ${m.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
  var data_offset = 0u;
  let indices_start = uniforms.last_index_dimension * global_idx;
  let indices_end = indices_start + uniforms.last_index_dimension;
  for (var i = indices_start; i < indices_end; i++) {
    var index = i32(indices[i].x);
    ${t[0].dims.length === 1 ? `
    let element_count_dim = uniforms.output_strides;
    let dim_value = uniforms.output_shape;` : `
    let element_count_dim = uniforms.output_strides[i - indices_start];
    let dim_value = uniforms.output_shape[i - indices_start];`}
    if (index >= 0) {
      if (index >= i32(dim_value)) {
        index = i32(dim_value - 1);
      }
    } else {
      if (index < -i32(dim_value)) {
        index = 0;
      } else {
        index += i32(dim_value);
      }
    }
    data_offset += u32((u32(index) * element_count_dim));
  }

  for (var i = 0u; i < uniforms.num_updates_elements; i++) {
    let value = updates[uniforms.num_updates_elements * global_idx + i];
    ${db(e4.reduction, "output[data_offset + i]", "value", b.type.value)}
  }

      }`;
    };
    return { name: "ScatterND", shaderCache: { hint: `${e4.cacheKey}_${e4.reduction}`, inputDependencies: ["rank", "rank"] }, getRunData: () => ({ outputs: [{ dims: o, dataType: t[0].dataType }], dispatchGroup: { x: Math.ceil(s / 64) }, programUniforms: c2 }), getShaderSource: p4 };
  }, fc = (t) => ee({ reduction: t.reduction }), hc = (t, e4) => {
    t.compute(lb(t.inputs, e4), { inputs: [t.inputs[1], t.inputs[2]], outputs: [] });
  };
});
var cb;
var pb;
var mb;
var bc;
var fb;
var hb;
var gb;
var bb;
var yb;
var _b;
var wb;
var vb;
var yc;
var $b;
var xb;
var Sb;
var Tb;
var Ib;
var _c;
var wc;
var vc = V(() => {
  "use strict";
  J();
  re();
  Ce();
  oe();
  cb = (t, e4) => {
    if (t.every((r) => r > 0 || (() => {
      throw new Error("Resize requires scales input values to be positive");
    })), t.length > 0) {
      if (e4.mode === "linear") {
        if (!(t.length === 2 || t.length === 3 || t.length === 4 && t[0] === 1 && t[1] === 1 || t.length === 4 && t[0] === 1 && t[3] === 1 || t.length === 5 && t[0] === 1 && t[1] === 1)) throw new Error(`For linear mode, Resize requires scales to be 2D, 3D, 4D with either two outermost or one innermost and
            one outermost scale values equal to 1, or 5D with two outermost scale values equal to 1`);
      } else if (e4.mode === "cubic" && !(t.length === 2 || t.length === 4 && t[0] === 1 && t[1] === 1 || t.length === 4 && t[0] === 1 && t[3] === 1)) throw new Error("Resize requires scales input size to be 2 or 4 for cubic mode");
    }
  }, pb = (t, e4, r) => {
    e4.every((o) => o >= 0 && o < r || (() => {
      throw new Error("Resize requires axes input values to be positive and less than rank");
    }));
    let n = new Array(r).fill(1);
    return e4.forEach((o, i) => n[o] = t[i]), n;
  }, mb = (t, e4, r, n, o, i) => {
    let [s, u, d] = r > 10 ? [1, 2, 3] : [-1, t.length > 1 ? 1 : -1, -1], c2 = t[0].dims.length;
    if (s > 0 && t.length > s && t[s].dims.length > 0) t[s].getFloat32Array().forEach((p4) => i.push(p4));
    else if (e4.coordinateTransformMode === "tf_crop_and_resize") throw new Error("Resize requires RoI input to be specified when coordinateTransformMode is tfCropAndResize");
    if (u > 0 && t.length > u && t[u].dims.length === 1 && t[u].dims[0] > 0) {
      if (t[u].getFloat32Array().forEach((p4) => n.push(p4)), n.length !== 0 && n.length !== c2 && r >= 18 && n.length !== e4.axes.length) throw new Error("Resize requires scales input size to be same as input rank or axes size for opset 18 and up");
      cb(n, e4), e4.axes.length > 0 && pb(n, e4.axes, c2).forEach((p4, m) => n[m] = p4);
    }
    if (d > 0 && t.length > d && t[d].dims.length === 1 && t[d].dims[0] > 0 && (t[d].getBigInt64Array().forEach((p4) => o.push(Number(p4))), o.length !== 0 && o.length !== c2 && r >= 18 && o.length !== e4.axes.length)) throw new Error("Resize requires sizes input size to be same as input rank or axes size for opset 18 and up");
    if (e4.axes.length > 0) {
      if (n.length !== 0 && n.length !== e4.axes.length) throw new Error('Resize requires "scales" input size to be of axes rank when axes attributes is specified');
      if (o.length !== 0 && o.length !== e4.axes.length) throw new Error('Resize requires "sizes" input size to be of rank axes rank when axes attributes is specified');
    }
    if (typeof n < "u" && typeof o < "u" && n.length > 0 && o.length > c2) throw new Error("Resize requires only of scales or sizes to be specified");
  }, bc = (t, e4, r, n) => `
  // The whole part and the fractional part are calculated separately due to inaccuracy of floating
  // point division. As an example, f32(21) / f32(7) may evaluate to 2.99... instead of 3, causing an
  // offset-by-one error later in floor().
  let big = (${t}) * (${e4});
  let whole = ${n}(big / (${r}));
  let fract = ${n}(big % (${r})) / ${n}(${r});
  return whole + fract;
`, fb = (t, e4) => `fn getOriginalCoordinateFromResizedCoordinate(xResized: u32, xScale: f32, lengthResized: u32,
     lengthOriginal: u32, roiStart: f32, roiEnd: f32) -> ${e4} { ` + (() => {
    switch (t) {
      case "asymmetric":
        return `
          if (xScale < 1.0 || floor(xScale) != xScale) {
            return ${e4}(xResized) / ${e4}(xScale);
          } else {
            ${bc("xResized", "lengthOriginal", "lengthResized", e4)}
          }
        `;
      case "pytorch_half_pixel":
        return `if (lengthResized > 1) {
                    return (${e4}(xResized) + 0.5) / ${e4}(xScale) - 0.5;
                  } else {
                    return 0.0;
                  }`;
      case "tf_half_pixel_for_nn":
        return `return (${e4}(xResized) + 0.5) / ${e4}(xScale);`;
      case "align_corners":
        return `if (lengthResized == 1) {
                    return 0.0;
                  } else {
                    ${bc("xResized", "lengthOriginal - 1", "lengthResized - 1", e4)}
                  }`;
      case "tf_crop_and_resize":
        return `if (lengthResized > 1) {
                    return ${e4}(roiStart) * ${e4}(lengthOriginal - 1) +
                        (${e4}(xResized) * ${e4}(roiEnd - roiStart) * ${e4}(lengthOriginal - 1)) /
                        ${e4}(lengthResized - 1);
                  } else {
                    return 0.5 * ${e4}(roiStart + roiEnd) * ${e4}(lengthOriginal - 1);
                  }`;
      case "half_pixel_symmetric":
        return `const outputWidth = ${e4}xScale * ${e4}(lengthResized);
                  const adjustment = ${e4}(lengthResized) / outputWidth;
                  const center = ${e4}(lengthOriginal) / 2;
                  const offset = center * (1 - adjustment);
                  return offset + ((${e4}(xResized) + 0.5) / ${e4}(xScale)) - 0.5;`;
      case "half_pixel":
        return `return ((${e4}(xResized) + 0.5) / ${e4}(xScale)) - 0.5;`;
      default:
        throw new Error(`Coordinate transform mode ${t} is not supported`);
    }
  })() + "}", hb = (t, e4, r) => `fn getNearestPixelFromOriginal(xOriginal: ${r}, isDownSample: bool) -> ${r} {` + (() => {
    switch (t) {
      case "round_prefer_ceil":
        return "if (fract(xOriginal) == 0.5) {             return ceil(xOriginal);           } else {             return round(xOriginal);           }";
      case "floor":
        return "return floor(xOriginal);";
      case "ceil":
        return "return ceil(xOriginal);";
      case "round_prefer_floor":
        return "if (fract(xOriginal) == 0.5) {                     return floor(xOriginal);                   } else {                     return round(xOriginal);                   }";
      case "simple":
      default:
        if (e4 < 11) return "if (isDownSample)                     {                       return ceil(xOriginal);                     } else {                       return xOriginal;                     }";
        throw new Error(`Nearest mode ${t} is not supported`);
    }
  })() + "}", gb = (t, e4, r) => {
    let n = new Array(r).fill(0).concat(new Array(r).fill(1)), o = t.length === 0 ? n : t.slice();
    return e4.length > 0 ? (e4.forEach((i, s) => {
      n[i] = o[s], n[s + r] = o[e4.length + s];
    }), n) : o;
  }, bb = (t, e4, r, n) => {
    let o = [];
    if (r.length > 0) if (n.length > 0) {
      if (t.forEach((i) => o.push(i)), Math.max(...n) > t.length) throw new Error("axes is out of bound");
      n.forEach((i, s) => o[i] = r[s]);
    } else r.forEach((i) => o.push(i));
    else {
      if (e4.length === 0) throw new Error("Resize requires either scales or sizes.");
      o = t.map((i, s) => Math.round(i * e4[s]));
    }
    return o;
  }, yb = (t, e4, r) => {
    let n = (() => {
      switch (r.keepAspectRatioPolicy) {
        case "not_larger":
          return r.axes.length > 0 ? Math.min(...r.axes.map((i) => e4[i]), Number.MAX_VALUE) : Math.min(...e4, Number.MAX_VALUE);
        case "not_smaller":
          return r.axes.length > 0 ? Math.max(...r.axes.map((i) => e4[i]), Number.MIN_VALUE) : Math.max(...e4, Number.MIN_VALUE);
        default:
          throw new Error(`Keep aspect ratio policy ${r.keepAspectRatioPolicy} is not supported`);
      }
    })();
    e4.fill(1, 0, e4.length);
    let o = t.slice();
    return r.axes.length > 0 ? (r.axes.forEach((i) => e4[i] = n), r.axes.forEach((i) => o[i] = Math.round(t[i] * e4[i]))) : (e4.fill(n, 0, e4.length), o.forEach((i, s) => o[s] = Math.round(i * e4[s]))), o;
  }, _b = (t, e4, r, n, o) => `
    fn calculateOriginalIndicesFromOutputIndices(output_indices: ${t.type.indices}) -> array<${t.type.value}, ${r.length}> {
      var original_indices: array<${t.type.value}, ${r.length}>;
      for (var i:u32 = 0; i < ${r.length}; i++) {
        var output_index = ${t.indicesGet("output_indices", "i")};
        var scale = ${j("uniforms.scales", "i", n)};
        var roi_low = ${j("uniforms.roi", "i", o)};
        var roi_hi = ${j("uniforms.roi", `i + ${e4.length}`, o)};
        if (scale == 1.0) {
          original_indices[i] = ${t.type.value}(output_index);
        } else {
          var input_shape_i = ${j("uniforms.input_shape", "i", e4.length)};
          var output_shape_i = ${j("uniforms.output_shape", "i", r.length)};
          original_indices[i] = getOriginalCoordinateFromResizedCoordinate(output_index, scale, output_shape_i,
                                                                           input_shape_i, roi_low, roi_hi);
        }
      }
      return original_indices;
    }`, wb = (t, e4, r, n, o, i, s) => `
    fn calculateInputIndicesFromOutputIndices(output_indices: ${e4.type.indices}) -> ${t.type.indices} {
      var input_indices: ${t.type.indices};
      for (var i:u32 = 0; i < ${n.length}; i++) {
        var output_index = ${e4.indicesGet("output_indices", "i")};
        var input_index: u32;
        var scale = ${j("uniforms.scales", "i", o)};
        if (scale == 1.0) {
          input_index = output_index;
        } else {
          var roi_low = ${j("uniforms.roi", "i", i)};
          var roi_hi = ${j("uniforms.roi", `i + ${r.length}`, i)};
          var input_shape_i = ${j("uniforms.input_shape", "i", r.length)};
          var output_shape_i = ${j("uniforms.output_shape", "i", n.length)};
          var original_idx = getOriginalCoordinateFromResizedCoordinate(output_index, scale, output_shape_i,
                                                                        input_shape_i, roi_low, roi_hi);
          if (!${s} || (original_idx >= 0 && original_idx < ${e4.type.value}(input_shape_i))) {
            if (original_idx < 0) {
              input_index = 0;
            } else if (original_idx > ${e4.type.value}(input_shape_i - 1)) {
              input_index = input_shape_i - 1;
            } else {
              input_index = u32(getNearestPixelFromOriginal(original_idx, scale < 1));
            }
          } else {
            input_index = u32(original_idx);
          }
        }
        ${t.indicesSet("input_indices", "i", "input_index")}
      }
      return input_indices;
    }`, vb = (t, e4) => `
    fn checkInputIndices(input_indices: ${t.type.indices}) -> bool {
      for (var i:u32 = 0; i < ${e4.length}; i++) {
        var input_index = ${t.indicesGet("input_indices", "i")};
        if (input_index < 0 || input_index >= ${j("uniforms.input_shape", "i", e4.length)}) {
          return false;
        }
      }
      return true;
    }`, yc = (t, e4, r, n) => t.rank > n ? `
    ${t.indicesSet("input_indices", e4, "channel")};
    ${t.indicesSet("input_indices", r, "batch")};
` : "", $b = (t, e4, r, n, o) => {
    let [s, u, d, c2] = r.length === 2 ? [-1, 0, 1, -1] : [0, 2, 3, 1], p4 = t.type.value;
    return `
    fn getInputValue(batch: u32, channel: u32, row: u32, col: u32) -> ${p4} {
      var input_indices: ${t.type.indices};
      ${t.indicesSet("input_indices", u, `max(0, min(row, ${r[u]} - 1))`)};
      ${t.indicesSet("input_indices", d, `max(0, min(col, ${r[d]} - 1))`)};
      ${yc(t, c2, s, 2)}
      return ${t.getByIndices("input_indices")};
    }

    fn bilinearInterpolation(output_indices: ${e4.type.indices}) -> ${p4} {
      var originalIndices = calculateOriginalIndicesFromOutputIndices(output_indices);
      var row:${p4} = originalIndices[${u}];
      var col:${p4} = originalIndices[${d}];
      ${n ? `if (row < 0 || row > (${r[u]} - 1) || col < 0 || col > (${r[d]} - 1)) {
        return ${o};
      }` : ""};
      row = max(0, min(row, ${r[u]} - 1));
      col = max(0, min(col, ${r[d]} - 1));
      var row1: u32 = u32(row);
      var col1: u32 = u32(col);
      var row2: u32 = u32(row + 1);
      var col2: u32 = u32(col + 1);
      var channel: u32 = ${r.length > 2 ? `u32(originalIndices[${c2}])` : "0"};
      var batch: u32 =  ${r.length > 2 ? `u32(originalIndices[${s}])` : "0"};
      var x11: ${p4} = getInputValue(batch, channel, row1, col1);
      var x12: ${p4} = getInputValue(batch, channel, row1, col2);
      var x21: ${p4} = getInputValue(batch, channel, row2, col1);
      var x22: ${p4} = getInputValue(batch, channel, row2, col2);
      var dx1: ${p4} = abs(row - ${p4}(row1));
      var dx2: ${p4} = abs(${p4}(row2) - row);
      var dy1: ${p4} = abs(col - ${p4}(col1));
      var dy2: ${p4} = abs(${p4}(col2) - col);
      if (row1 == row2) {
        dx1 = 0.5;
        dx2 = 0.5;
      }
      if (col1 == col2) {
        dy1 = 0.5;
        dy2 = 0.5;
      }
      return (x11 * dx2 * dy2 + x12 * dx2 * dy1 + x21 * dx1 * dy2 + x22 * dx1 * dy1);
    }`;
  }, xb = (t, e4, r, n, o, i, s, u, d, c2) => {
    let p4 = r.length === 2, m = true, [g, y] = p4 ? [0, 1] : m ? [2, 3] : [1, 2], b = t.type.value, _ = (T) => {
      let x = T === g ? "row" : "col";
      return `
      fn ${x}CubicInterpolation(input_indices: ${t.type.indices}, output_indices: ${e4.type.indices}) -> ${b} {
        var output_index = ${e4.indicesGet("output_indices", T)};
        var originalIdx: ${b} = getOriginalCoordinateFromResizedCoordinate(output_index, ${o[T]},
        ${n[T]}, ${r[T]}, ${i[T]}, ${i[T]} + ${r.length});
        var fractOriginalIdx: ${b} = originalIdx - floor(originalIdx);
        var coefs = getCubicInterpolationCoefs(fractOriginalIdx);

        if (${u} && (originalIdx < 0 || originalIdx > (${r[T]} - 1))) {
          return ${d};
        }
        var data: array<${b}, 4> = array<${b}, 4>(0.0, 0.0, 0.0, 0.0);
        for (var i: i32 = -1; i < 3; i++) {
          var ${x}: ${b} = originalIdx + ${b}(i);
          if (${x} < 0 || ${x} >= ${r[T]}) {
            ${c2 ? `coefs[i + 1] = 0.0;
                        continue;` : u ? `return ${d};` : `${x} = max(0, min(${x}, ${r[T]} - 1));`};
          }
        var input_indices_copy: ${t.type.indices} = input_indices;
          ${t.indicesSet("input_indices_copy", T, `u32(${x})`)};
          data[i + 1] = ${T === g ? t.getByIndices("input_indices_copy") : "rowCubicInterpolation(input_indices_copy, output_indices)"};
        }
        return cubicInterpolation1D(data, coefs);
      }`;
    };
    return `
    ${_(g)};
    ${_(y)};
  fn getCubicInterpolationCoefs(s: ${b}) -> array<${b}, 4> {
    var absS = abs(s);
    var coeffs: array<${b}, 4> = array<${b}, 4>(0.0, 0.0, 0.0, 0.0);
    var oneMinusAbsS: ${b} = 1.0 - absS;
    var twoMinusAbsS: ${b} = 2.0 - absS;
    var onePlusAbsS: ${b} = 1.0 + absS;
    coeffs[0] = ((${s} * onePlusAbsS - 5 * ${s}) * onePlusAbsS + 8 * ${s}) * onePlusAbsS - 4 * ${s};
    coeffs[1] = ((${s} + 2) * absS - (${s} + 3)) * absS * absS + 1;
    coeffs[2] = ((${s} + 2) * oneMinusAbsS - (${s} + 3)) * oneMinusAbsS * oneMinusAbsS + 1;
    coeffs[3] = ((${s} * twoMinusAbsS - 5 * ${s}) * twoMinusAbsS + 8 * ${s}) * twoMinusAbsS - 4 * ${s};
    return coeffs;
  }

  fn cubicInterpolation1D(x: array<${b}, 4>, coefs: array<${b}, 4>) -> ${b} {
    var coefsSum: ${b} = coefs[0] + coefs[1] + coefs[2] + coefs[3];
    return (x[0] * coefs[0] + x[1] * coefs[1]+ x[2] * coefs[2]+ x[3] * coefs[3]) / coefsSum;
  }

  fn bicubicInterpolation(output_indices: ${e4.type.indices}) -> ${b} {
    var input_indices: ${t.type.indices} = output_indices;
    return colCubicInterpolation(input_indices, output_indices);
  }
    `;
  }, Sb = (t, e4, r, n, o) => {
    let [s, u, d, c2, p4] = r.length === 3 ? [-1, 0, 1, 2, -1] : [0, 2, 3, 4, 1], m = t.type.value;
    return `
    fn getInputValue(batch: u32, channel: u32, depth:u32, height: u32, width: u32) -> ${m} {
      var input_indices: ${t.type.indices};
      ${t.indicesSet("input_indices", u, `max(0, min(depth, ${r[u]} - 1))`)};
      ${t.indicesSet("input_indices", d, `max(0, min(height, ${r[d]} - 1))`)};
      ${t.indicesSet("input_indices", c2, `max(0, min(width, ${r[c2]} - 1))`)};
      ${yc(t, p4, s, 3)}
      return ${t.getByIndices("input_indices")};
    }

    fn trilinearInterpolation(output_indices: ${e4.type.indices}) -> ${m} {
      var originalIndices = calculateOriginalIndicesFromOutputIndices(output_indices);
      var depth:${m} = originalIndices[${u}];
      var height:${m} = originalIndices[${d}];
      var width:${m} = originalIndices[${c2}];
      ${n ? `if (depth < 0 || depth > (${r[u]} - 1) || height < 0 || height > (${r[d]} - 1) || width < 0 || (width > ${r[c2]} - 1)) {
      return ${o};
        }` : ""};

    depth = max(0, min(depth, ${r[u]} - 1));
      height = max(0, min(height, ${r[d]} - 1));
      width = max(0, min(width, ${r[c2]} - 1));
      var depth1: u32 = u32(depth);
      var height1: u32 = u32(height);
      var width1: u32 = u32(width);
      var depth2: u32 = u32(depth + 1);
      var height2: u32 = u32(height + 1);
      var width2: u32 = u32(width + 1);
      var channel: u32 = ${r.length > 3 ? `u32(originalIndices[${p4}])` : "0"};
      var batch: u32 =  ${r.length > 3 ? `u32(originalIndices[${s}])` : "0"};

      var x111: ${m} = getInputValue(batch, channel, depth1, height1, width1);
      var x112: ${m} = getInputValue(batch, channel, depth1, height1, width2);
      var x121: ${m} = getInputValue(batch, channel, depth1, height2, width1);
      var x122: ${m} = getInputValue(batch, channel, depth1, height2, width2);
      var x211: ${m} = getInputValue(batch, channel, depth2, height1, width1);
      var x212: ${m} = getInputValue(batch, channel, depth2, height1, width2);
      var x221: ${m} = getInputValue(batch, channel, depth2, height2, width1);
      var x222: ${m} = getInputValue(batch, channel, depth2, height2, width2);
      var dx1: ${m} = abs(depth - ${m}(depth1));
      var dx2: ${m} = abs(${m}(depth2) - depth);
      var dy1: ${m} = abs(height - ${m}(height1));
      var dy2: ${m} = abs(${m}(height2) - height);
      var dz1: ${m} = abs(width - ${m}(width1));
      var dz2: ${m} = abs(${m}(width2) - width);
      if (depth1 == depth2) {
        dx1 = 0.5;
        dx2 = 0.5;
      }
      if (height1 == height2) {
        dy1 = 0.5;
        dy2 = 0.5;
      }
      if (width1 == width2) {
        dz1 = 0.5;
        dz2 = 0.5;
      }
      return (x111 * dx2 * dy2 * dz2 + x112 * dx2 * dy2 * dz1 + x121 * dx2 * dy1 *dz2 + x122 * dx2 * dy1 * dz1 +
              x211 * dx1 * dy2 * dz2 + x212 * dx1 * dy2 * dz1 + x221 * dx1 * dy1 *dz2 + x222 * dx1 * dy1 * dz1);
    }`;
  }, Tb = (t, e4, r, n, o, i) => {
    let s = t.dims, u = gb(i, e4.axes, s.length), d = bb(s, n, o, e4.axes), c2 = n.slice();
    n.length === 0 && (c2 = s.map(($, S) => $ === 0 ? 1 : d[S] / $), e4.keepAspectRatioPolicy !== "stretch" && (d = yb(s, c2, e4)));
    let p4 = U("output", t.dataType, d.length), m = O("input", t.dataType, s.length), g = k4.size(d), y = s.length === d.length && s.every(($, S) => $ === d[S]), b = e4.coordinateTransformMode === "tf_crop_and_resize", _ = e4.extrapolationValue, T = m.type.value, x = ($) => `
      ${y ? "" : `
      ${fb(e4.coordinateTransformMode, T)};
      ${(() => {
      switch (e4.mode) {
        case "nearest":
          return `
              ${vb(m, s)};
              ${hb(e4.nearestMode, r, T)};
              ${wb(m, p4, s, d, c2.length, u.length, b)};
              `;
        case "linear":
          return `
              ${_b(p4, s, d, c2.length, u.length)};
              ${(() => {
            if (s.length === 2 || s.length === 4) return `${$b(m, p4, s, b, _)}`;
            if (s.length === 3 || s.length === 5) return `${Sb(m, p4, s, b, _)}`;
            throw Error("Linear mode only supports input dims 2, 3, 4 and 5 are supported in linear mode.");
          })()};
            `;
        case "cubic":
          return `
            ${(() => {
            if (s.length === 2 || s.length === 4) return `${xb(m, p4, s, d, c2, u, e4.cubicCoeffA, b, e4.extrapolationValue, e4.excludeOutside)}`;
            throw Error("Cubic mode only supports input dims 2 and 4 are supported in linear mode.");
          })()};
            `;
        default:
          throw Error("Invalid resize mode");
      }
    })()};
      `}
      ${$.registerUniform("output_size", "u32").registerUniform("scales", "f32", c2.length).registerUniform("roi", "f32", u.length).declareVariables(m, p4)}
      ${$.mainStart()}
        ${$.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
        ${y ? "output[global_idx] = input[global_idx];" : `
        let output_indices = ${p4.offsetToIndices("global_idx")};
        var input_indices: ${m.type.indices};
        ${(() => {
      switch (e4.mode) {
        case "nearest":
          return `input_indices = calculateInputIndicesFromOutputIndices(output_indices);
                if (checkInputIndices(input_indices)) {
                  output[global_idx] = ${m.getByIndices("input_indices")};
                } else {
                  output[global_idx] = ${e4.extrapolationValue};
                }`;
        case "linear":
          return `output[global_idx] = ${s.length === 2 || s.length === 4 ? "bilinearInterpolation" : "trilinearInterpolation"}(output_indices);`;
        case "cubic":
          return "output[global_idx] = bicubicInterpolation(output_indices);";
        default:
          throw Error(`Unsupported resize mode: ${e4.mode}`);
      }
    })()};
`}
      }`;
    return { name: "Resize", shaderCache: { hint: `${e4.cacheKey}|${r}|${c2.length > 0 ? e4.mode === "cubic" ? c2 : c2.length : ""}|${o.length > 0 ? o : ""}|${u.length > 0 ? u : ""}|${y}|${e4.mode === "nearest" ? s.length : s}`, inputDependencies: ["rank"] }, getShaderSource: x, getRunData: () => ({ outputs: [{ dims: d, dataType: t.dataType }], dispatchGroup: { x: Math.ceil(g / 64) }, programUniforms: [{ type: 12, data: g }, { type: 1, data: c2 }, { type: 1, data: u }, ...W(s, d)] }) };
  }, Ib = (t) => {
    let e4 = t.customDataBuffer;
    return new Uint32Array(e4.buffer, e4.byteOffset, 1)[0];
  }, _c = (t, e4) => {
    let r = [], n = [], o = [], i = Ib(t);
    if (e4.antialias !== 0) throw Error("Only default value (0) for Antialias attribute is supported");
    mb(t.inputs, e4, i, r, n, o), t.compute(Tb(t.inputs[0], e4, i, r, n, o), { inputs: [0] });
  }, wc = (t) => {
    let e4 = t.antialias, r = t.axes, n = t.coordinateTransformMode, o = t.cubicCoeffA, i = t.excludeOutside !== 0, s = t.extrapolationValue, u = t.keepAspectRatioPolicy, d = t.mode, c2 = t.nearestMode === "" ? "simple" : t.nearestMode;
    return ee({ antialias: e4, axes: r, coordinateTransformMode: n, cubicCoeffA: o, excludeOutside: i, extrapolationValue: s, keepAspectRatioPolicy: u, mode: d, nearestMode: c2 });
  };
});
var Cb;
var Ab;
var $c;
var xc = V(() => {
  "use strict";
  J();
  re();
  oe();
  Cb = (t) => {
    if (!t || t.length < 3) throw new Error("layerNorm requires at least 3 inputs.");
    let e4 = t[0], r = t[1], n = t[2];
    if (e4.dataType !== r.dataType || e4.dataType !== n.dataType) throw new Error("All inputs must have the same data type");
    if (e4.dims.length !== 3 && e4.dims.length !== 2) throw new Error("Input must be 2D or 3D");
    if (r.dims.length !== 3 && r.dims.length !== 2) throw new Error("Skip must be 2D or 3D");
    let o = e4.dims[e4.dims.length - 1], i = e4.dims[e4.dims.length - 2];
    if (r.dims[r.dims.length - 1] !== o) throw new Error("Skip must have the same hidden size as input");
    if (r.dims[r.dims.length - 2] !== i) throw new Error("Skip must have the same sequence length as input");
    if (n.dims.length !== 1) throw new Error("Gamma must be 1D");
    if (n.dims[n.dims.length - 1] !== o) throw new Error("Gamma must have the same hidden size as input");
    if (t.length > 3) {
      let s = t[3];
      if (s.dims.length !== 1) throw new Error("Beta must be 1D");
      if (s.dims[s.dims.length - 1] !== o) throw new Error("Beta must have the same hidden size as input");
    }
    if (t.length > 4) {
      let s = t[4];
      if (s.dims.length !== 1) throw new Error("Bias must be 1D");
      if (s.dims[s.dims.length - 1] !== o) throw new Error("Bias must have the same hidden size as input");
    }
  }, Ab = (t, e4, r, n) => {
    let o = e4.simplified, i = t[0].dims, s = k4.size(i), u = i, d = s, c2 = i.slice(-1)[0], p4 = n ? i.slice(0, -1).concat(1) : [], m = !o && t.length > 3, g = t.length > 4, y = n && r > 1, b = n && r > 2, _ = r > 3, T = 64, x = fe(c2), $ = [{ type: 12, data: d }, { type: 12, data: x }, { type: 12, data: c2 }, { type: 1, data: e4.epsilon }], S = (E) => {
      let A = [{ name: "output_size", type: "u32" }, { name: "components", type: "u32" }, { name: "hidden_size", type: "u32" }, { name: "epsilon", type: "f32" }], z = [O("x", t[0].dataType, t[0].dims, x), O("skip", t[1].dataType, t[1].dims, x), O("gamma", t[2].dataType, t[2].dims, x)];
      m && z.push(O("beta", t[3].dataType, t[3].dims, x)), g && z.push(O("bias", t[4].dataType, t[4].dims, x)), z.push(U("output", t[0].dataType, u, x)), y && z.push(U("mean_output", 1, p4)), b && z.push(U("inv_std_output", 1, p4)), _ && z.push(U("input_skip_bias_sum", t[0].dataType, u, x));
      let v = we(t[0].dataType), R = we(1, x);
      return `

      ${E.registerUniforms(A).declareVariables(...z)}
      var<workgroup> sum_shared : array<${R}, ${T}>;
      var<workgroup> sum_squared_shared : array<${R}, ${T}>;

      ${E.mainStart([T, 1, 1])}
        let ix = local_id.x;
        let iy = global_id.x / ${T};

        let hidden_size_vectorized: u32 = uniforms.hidden_size / uniforms.components;
        var stride = hidden_size_vectorized / ${T};
        let offset = ix * stride + iy * hidden_size_vectorized;
        let offset1d = stride * ix;
        if (ix == ${T - 1}) {
          stride = hidden_size_vectorized - stride * ix;
        }
        for (var i: u32 = 0; i < stride; i++) {
          let skip_value = skip[offset + i];
          let bias_value = ${g ? "bias[offset1d + i]" : v + "(0.0)"};
          let input_value = x[offset + i];
          let value = input_value + skip_value + bias_value;
          ${_ ? "input_skip_bias_sum[offset + i] = value;" : ""}
          output[offset + i] = value;
          let f32_value = ${Dt(v, x, "value")};
          sum_shared[ix] += f32_value;
          sum_squared_shared[ix] += f32_value * f32_value;
        }
        workgroupBarrier();

        var reduce_size : u32 = ${T};
        for (var curr_size = reduce_size >> 1;  curr_size > 0; curr_size = reduce_size >> 1) {
          reduce_size = curr_size + (reduce_size & 1);
          if (ix < curr_size) {
            sum_shared[ix] += sum_shared[ix + reduce_size];
            sum_squared_shared[ix] += sum_squared_shared[ix + reduce_size];
          }
          workgroupBarrier();
        }

        let sum = sum_shared[0];
        let square_sum = sum_squared_shared[0];
        let mean = ${Ze("sum", x)} / f32(uniforms.hidden_size);
        let inv_std_dev = inverseSqrt(${Ze("square_sum", x)} / f32(uniforms.hidden_size) ${o ? "" : "- mean * mean"} + uniforms.epsilon);
        ${y ? "mean_output[global_idx] = mean;" : ""}
        ${b ? "inv_std_output[global_idx] = inv_std_dev;" : ""}

        for (var i: u32 = 0; i < stride; i++) {
          output[offset + i] = (output[offset + i] ${o ? "" : `- ${v}(mean)`}) *
            ${v}(inv_std_dev) * gamma[offset1d + i]
            ${m ? "+ beta[offset1d + i]" : ""};
        }
      }`;
    }, I = [{ dims: u, dataType: t[0].dataType }];
    return r > 1 && I.push({ dims: p4, dataType: 1 }), r > 2 && I.push({ dims: p4, dataType: 1 }), r > 3 && I.push({ dims: i, dataType: t[0].dataType }), { name: "SkipLayerNormalization", shaderCache: { hint: `${x};${y};${b};${_}`, inputDependencies: t.map((E, A) => "type") }, getShaderSource: S, getRunData: () => ({ outputs: I, dispatchGroup: { x: Math.ceil(d / c2) }, programUniforms: $ }) };
  }, $c = (t, e4) => {
    Cb(t.inputs);
    let n = [0];
    t.outputCount > 1 && n.push(-3), t.outputCount > 2 && n.push(-3), t.outputCount > 3 && n.push(3), t.compute(Ab(t.inputs, e4, t.outputCount, false), { outputs: n });
  };
});
var Eb;
var pn;
var kb;
var Sc;
var Pb;
var Ob;
var Tc;
var Ic;
var Cc = V(() => {
  "use strict";
  J();
  re();
  Ce();
  oe();
  Eb = (t, e4) => {
    if (!t || t.length < 1) throw new Error("too few inputs");
    if (e4.axes.length !== 0) {
      if (e4.axes.length !== e4.starts.length || e4.axes.length !== e4.ends.length) throw new Error("axes, starts and ends must have the same length");
    } else if (e4.starts.length !== e4.ends.length) throw new Error("starts and ends must have the same length");
    t.slice(1).forEach((r, n) => {
      if (t[n + 1].dataType !== 6 && t[n + 1].dataType !== 7) throw new Error(`Input ${n} must be an array of int32 or int64`);
    });
  }, pn = (t, e4) => {
    let r = [];
    if (t.length > e4) if (t[e4].dataType === 7) t[e4].getBigInt64Array().forEach((n) => r.push(Number(n)));
    else if (t[e4].dataType === 6) t[e4].getInt32Array().forEach((n) => r.push(Number(n)));
    else throw new Error(`Input ${e4} must be an array of int32 or int64`);
    return r;
  }, kb = (t, e4) => {
    if (t.length > 1) {
      let r = pn(t, 1), n = pn(t, 2), o = pn(t, 3);
      return o.length === 0 && (o = [...Array(t[0].dims.length).keys()]), ee({ starts: r, ends: n, axes: o });
    } else return e4;
  }, Sc = (t, e4, r, n, o) => {
    let i = t;
    return t < 0 && (i += r[n[e4]]), o[e4] < 0 ? Math.max(0, Math.min(i, r[n[e4]] - 1)) : Math.max(0, Math.min(i, r[n[e4]]));
  }, Pb = (t, e4, r) => `fn calculateInputIndices(output_indices: ${e4.type.indices}) -> ${t.type.indices} {
          var input_indices: ${t.type.indices};
          var carry = 0u;
          for (var i = ${r.length - 1}; i >= 0; i--) {
            let input_shape_i = ${j("uniforms.input_shape", "i", r.length)};
            let steps_i = ${j("uniforms.steps", "i", r.length)};
            let signs_i = ${j("uniforms.signs", "i", r.length)};
            let starts_i = ${j("uniforms.starts", "i", r.length)};
            var output_index = ${e4.indicesGet("output_indices", "i")};
            var input_index = output_index * steps_i + starts_i + carry;
            carry = input_index / input_shape_i;
            input_index = input_index % input_shape_i;
            if (signs_i < 0) {
              input_index = input_shape_i - input_index - 1u + starts_i;
            }
            ${t.indicesSet("input_indices", "i", "input_index")};
          }
          return input_indices;
      }`, Ob = (t, e4) => {
    let r = t[0].dims, n = k4.size(r), o = e4.axes.length > 0 ? k4.normalizeAxes(e4.axes, r.length) : [...Array(r.length).keys()], i = pn(t, 4);
    i.forEach((x) => x !== 0 || (() => {
      throw new Error("step cannot be 0");
    })), i.length === 0 && (i = Array(o.length).fill(1));
    let s = e4.starts.map((x, $) => Sc(x, $, r, o, i)), u = e4.ends.map((x, $) => Sc(x, $, r, o, i));
    if (o.length !== s.length || o.length !== u.length) throw new Error("start, ends and axes should have the same number of elements");
    if (o.length !== r.length) for (let x = 0; x < r.length; ++x) o.includes(x) || (s.splice(x, 0, 0), u.splice(x, 0, r[x]), i.splice(x, 0, 1));
    let d = i.map((x) => Math.sign(x));
    i.forEach((x, $, S) => {
      if (x < 0) {
        let I = (u[$] - s[$]) / x, E = s[$], A = E + I * i[$];
        s[$] = A, u[$] = E, S[$] = -x;
      }
    });
    let c2 = r.slice(0);
    o.forEach((x, $) => {
      c2[x] = Math.ceil((u[x] - s[x]) / i[x]);
    });
    let p4 = { dims: c2, dataType: t[0].dataType }, m = U("output", t[0].dataType, c2.length), g = O("input", t[0].dataType, t[0].dims.length), y = k4.size(c2), b = [{ name: "outputSize", type: "u32" }, { name: "starts", type: "u32", length: s.length }, { name: "signs", type: "i32", length: d.length }, { name: "steps", type: "u32", length: i.length }], _ = [{ type: 12, data: y }, { type: 12, data: s }, { type: 6, data: d }, { type: 12, data: i }, ...W(t[0].dims, c2)], T = (x) => `
      ${x.registerUniforms(b).declareVariables(g, m)}
        ${Pb(g, m, r)}
        ${x.mainStart()}
          ${x.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
          let output_indices = ${m.offsetToIndices("global_idx")};
          let input_indices = calculateInputIndices(output_indices);
          ${m.setByOffset("global_idx", g.getByIndices("input_indices"))}
      }`;
    return { name: "Slice", shaderCache: { hint: `${d.length}_${s.length}_${i.length}`, inputDependencies: ["rank"] }, getShaderSource: T, getRunData: () => ({ outputs: [p4], dispatchGroup: { x: Math.ceil(n / 64) }, programUniforms: _ }) };
  }, Tc = (t, e4) => {
    Eb(t.inputs, e4);
    let r = kb(t.inputs, e4);
    t.compute(Ob(t.inputs, r), { inputs: [0] });
  }, Ic = (t) => {
    let e4 = t.starts, r = t.ends, n = t.axes;
    return ee({ starts: e4, ends: r, axes: n });
  };
});
var zb;
var Bb;
var Ac;
var Ec;
var kc = V(() => {
  "use strict";
  J();
  re();
  Ce();
  pt();
  oe();
  zb = (t) => {
    if (!t || t.length !== 1) throw new Error("Softmax op requires 1 input.");
  }, Bb = (t, e4) => {
    let r = t.inputs[0], n = r.dims, o = k4.size(n), i = n.length, s = k4.normalizeAxis(e4.axis, i), u = s < n.length - 1, d, c2 = [];
    u ? (c2 = Array.from({ length: i }, (z, v) => v), c2[s] = i - 1, c2[i - 1] = s, d = t.compute(Be(r, c2), { inputs: [r], outputs: [-1] })[0]) : d = r;
    let p4 = d.dims, m = p4[i - 1], g = o / m, y = fe(m), b = m / y, _ = 64;
    g === 1 && (_ = 256);
    let T = (z, v) => v === 4 ? `max(max(${z}.x, ${z}.y), max(${z}.z, ${z}.w))` : v === 2 ? `max(${z}.x, ${z}.y)` : v === 3 ? `max(max(${z}.x, ${z}.y), ${z}.z)` : z, x = O("x", d.dataType, d.dims, y), $ = U("result", d.dataType, d.dims, y), S = x.type.value, I = we(d.dataType) === "f32" ? `var threadMax = ${S}(-3.4028234663852886e+38f);` : `var threadMax = ${S}(-65504.0h);`, E = (z) => `
      var<workgroup> rowMaxShared : ${S};
      var<workgroup> rowSumShared : ${S};
      var<workgroup> threadShared : array<${S}, ${_}>;

      fn getValue(row: i32, col: i32, row_stride: i32) -> ${S} {
        let index = row * row_stride + col;
        return x[index];
      }

      fn setValue(row: i32, col: i32, row_stride: i32, value: ${S}) {
        let index = row * row_stride + col;
        result[index] = value;
      }
      ${z.registerUniform("packedCols", "i32").declareVariables(x, $)}
      ${z.mainStart(_)}
        let gindex = i32(global_idx);
        let lindex = i32(local_idx);
        const wg = ${_};
        let row = gindex / wg;
        let cols = uniforms.packedCols;
        let row_stride : i32 = uniforms.packedCols;

        // find the rows max
        ${I}
        for (var col = lindex; col < cols; col += wg) {
          let value = getValue(row, col, row_stride);
          threadMax = max(threadMax, value);
        }
        if (lindex < cols) {
          threadShared[lindex] = threadMax;
        }
        workgroupBarrier();

        var reduceSize = min(cols, wg);
        for (var currSize = reduceSize >> 1;  currSize > 0; currSize = reduceSize >> 1) {
          reduceSize = currSize + (reduceSize & 1);
          if (lindex < currSize) {
            threadShared[lindex] = max(threadShared[lindex], threadShared[lindex + reduceSize]);
          }
          workgroupBarrier();
        }
        if (lindex == 0) {
          rowMaxShared = ${S}(${T("threadShared[0]", y)});
        }
        workgroupBarrier();

        // find the rows sum
        var threadSum = ${S}(0.0);
        for (var col = lindex; col < cols; col += wg) {
          let subExp = exp(getValue(row, col, row_stride) - rowMaxShared);
          threadSum += subExp;
        }
        threadShared[lindex] = threadSum;
        workgroupBarrier();

        for (var currSize = wg >> 1;  currSize > 0; currSize = currSize >> 1) {
          if (lindex < currSize) {
            threadShared[lindex] = threadShared[lindex] + threadShared[lindex + currSize];
          }
          workgroupBarrier();
        }
        if (lindex == 0) {
          rowSumShared = ${S}(${Ze("threadShared[0]", y)});
        }
        workgroupBarrier();

        // calculate final value for each element in the row
        for (var col = lindex; col < cols; col += wg) {
          var value = exp(getValue(row, col, row_stride) - rowMaxShared) / rowSumShared;
          // max operation protects against NaN since all values should be >=0
          value = max(value, ${S}(0.0));
          setValue(row, col, row_stride, value);
        }
      }`, A = t.compute({ name: "Softmax", shaderCache: { hint: `${y};${_}`, inputDependencies: ["type"] }, getRunData: () => ({ outputs: [{ dims: p4, dataType: d.dataType }], dispatchGroup: { x: g }, programUniforms: [{ type: 6, data: b }] }), getShaderSource: E }, { inputs: [d], outputs: [u ? -1 : 0] })[0];
    u && t.compute(Be(A, c2), { inputs: [A] });
  }, Ac = (t, e4) => {
    zb(t.inputs), Bb(t, e4);
  }, Ec = (t) => ee({ axis: t.axis });
});
var Pc;
var Db;
var Mb;
var Rb;
var Oc;
var zc = V(() => {
  "use strict";
  J();
  re();
  oe();
  Pc = (t) => Array.from(t.getBigInt64Array(), Number), Db = (t) => {
    if (!t || t.length !== 2) throw new Error("Tile requires 2 inputs.");
    if (t[0].dataType !== 1 && t[0].dataType !== 10 && t[0].dataType !== 6 && t[0].dataType !== 12) throw new Error("Tile only support float, float16, int32, and uint32 data types");
    if (t[1].dataType !== 7) throw new Error("Tile `repeats` input should be of int64 data type");
    if (t[1].dims.length !== 1) throw new Error("Tile `repeats` input should be 1-D");
    if (Pc(t[1]).length !== t[0].dims.length) throw new Error("Tile `repeats` input should have same number of elements as rank of input data tensor");
  }, Mb = (t, e4) => {
    let r = [];
    for (let n = 0; n < t.length; ++n) r.push(t[n] * e4[n]);
    return r;
  }, Rb = (t, e4) => {
    let r = t[0].dims, n = e4 ?? Pc(t[1]), o = Mb(r, n), i = k4.size(o), s = t[0].dataType, u = O("input", s, r.length), d = U("output", s, o.length), c2 = (p4) => `
      const inputShape = ${u.indices(...r)};
      ${p4.registerUniform("output_size", "u32").declareVariables(u, d)}
      ${p4.mainStart()}
      ${p4.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
      let output_indices = ${d.offsetToIndices("global_idx")};
      var input_indices: ${u.type.indices};
      for (var i = 0; i < ${r.length}; i++) {
        let input_dim_i = ${u.indicesGet("uniforms.input_shape", "i")};
        let input_dim_value = ${d.indicesGet("output_indices", "i")}  % input_dim_i;

        ${u.indicesSet("input_indices", "i", "input_dim_value")}
      }
      ${d.setByOffset("global_idx", u.getByIndices("input_indices"))}
    }`;
    return { name: "Tile", shaderCache: { hint: `${n}`, inputDependencies: ["rank"] }, getRunData: () => ({ outputs: [{ dims: o, dataType: t[0].dataType }], dispatchGroup: { x: Math.ceil(i / 64) }, programUniforms: [{ type: 12, data: i }, ...W(t[0].dims, o)] }), getShaderSource: c2 };
  }, Oc = (t) => {
    Db(t.inputs), t.compute(Rb(t.inputs), { inputs: [0] });
  };
});
var Ub;
var Nb;
var Bc;
var Dc = V(() => {
  "use strict";
  J();
  re();
  oe();
  Ub = (t, e4, r, n, o) => {
    let i = U("output_data", o, r.length, 4), s = O("a_data", e4[1].dataType, e4[1].dims.length, 4), u = O("b_data", e4[2].dataType, e4[2].dims.length, 4), d = O("c_data", e4[0].dataType, e4[0].dims.length, 4), c2, p4 = (m, g, y) => `select(${g}, ${m}, ${y})`;
    if (!n) c2 = i.setByOffset("global_idx", p4(s.getByOffset("global_idx"), u.getByOffset("global_idx"), d.getByOffset("global_idx")));
    else {
      let m = (g, y, b = "") => {
        let _ = `a_data[index_a${y}][component_a${y}]`, T = `b_data[index_b${y}][component_b${y}]`, x = `bool(c_data[index_c${y}] & (0xffu << (component_c${y} * 8)))`;
        return `
            let output_indices${y} = ${i.offsetToIndices(`global_idx * 4u + ${y}u`)};
            let offset_a${y} = ${s.broadcastedIndicesToOffset(`output_indices${y}`, i)};
            let offset_b${y} = ${u.broadcastedIndicesToOffset(`output_indices${y}`, i)};
            let offset_c${y} = ${d.broadcastedIndicesToOffset(`output_indices${y}`, i)};
            let index_a${y} = offset_a${y} / 4u;
            let index_b${y} = offset_b${y} / 4u;
            let index_c${y} = offset_c${y} / 4u;
            let component_a${y} = offset_a${y} % 4u;
            let component_b${y} = offset_b${y} % 4u;
            let component_c${y} = offset_c${y} % 4u;
            ${g}[${y}] = ${b}(${p4(_, T, x)});
          `;
      };
      o === 9 ? c2 = `
            var data = vec4<u32>(0);
            ${m("data", 0, "u32")}
            ${m("data", 1, "u32")}
            ${m("data", 2, "u32")}
            ${m("data", 3, "u32")}
            output_data[global_idx] = dot(vec4<u32>(0x1, 0x100, 0x10000, 0x1000000), vec4<u32>(data));` : c2 = `
            ${m("output_data[global_idx]", 0)}
            ${m("output_data[global_idx]", 1)}
            ${m("output_data[global_idx]", 2)}
            ${m("output_data[global_idx]", 3)}
          `;
    }
    return `
        ${t.registerUniform("vec_size", "u32").declareVariables(d, s, u, i)}
        ${t.mainStart()}
        ${t.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.vec_size")}
        ${c2}
      }`;
  }, Nb = (t) => {
    let e4 = t[1].dims, r = t[2].dims, n = t[0].dims, o = t[1].dataType, i = !(k4.areEqual(e4, r) && k4.areEqual(r, n)), s = e4, u = k4.size(e4);
    if (i) {
      let c2 = ot.calcShape(ot.calcShape(e4, r, false), n, false);
      if (!c2) throw new Error("Can't perform where op on the given tensors");
      s = c2, u = k4.size(s);
    }
    let d = Math.ceil(u / 4);
    return { name: "Where", shaderCache: { inputDependencies: ["rank", "rank", "rank"] }, getShaderSource: (c2) => Ub(c2, t, s, i, o), getRunData: () => ({ outputs: [{ dims: s, dataType: o }], dispatchGroup: { x: Math.ceil(u / 64 / 4) }, programUniforms: [{ type: 12, data: d }, ...W(n, e4, r, s)] }) };
  }, Bc = (t) => {
    t.compute(Nb(t.inputs));
  };
});
var Mc;
var Rc = V(() => {
  "use strict";
  bu();
  Jr();
  wu();
  $u();
  sd();
  yd();
  vd();
  Rd();
  Hd();
  Kd();
  Qd();
  tl();
  ol();
  al();
  dl();
  pl();
  hl();
  yl();
  vl();
  Sl();
  zl();
  Ml();
  Ul();
  Vl();
  Gl();
  ko();
  Fl();
  uc();
  cc();
  mc();
  gc();
  Yr();
  vc();
  zo();
  xc();
  Cc();
  kc();
  Oo();
  zc();
  pt();
  tn();
  Dc();
  Mc = /* @__PURE__ */ new Map([["Abs", [xu]], ["Acos", [Su]], ["Acosh", [Tu]], ["Add", [ud]], ["ArgMax", [gu, bo]], ["ArgMin", [hu, bo]], ["Asin", [Iu]], ["Asinh", [Cu]], ["Atan", [Au]], ["Atanh", [Eu]], ["Attention", [yu]], ["AveragePool", [Jl, Xl]], ["BatchNormalization", [_u]], ["BiasAdd", [vu]], ["BiasSplitGelu", [ad]], ["Cast", [Pu, ku]], ["Ceil", [zu]], ["Clip", [Ou]], ["Concat", [_d, wd]], ["Conv", [Io, To]], ["ConvTranspose", [Gd, Ld]], ["Cos", [Bu]], ["Cosh", [Du]], ["CumSum", [Fd, qd]], ["DepthToSpace", [jd, Zd]], ["DequantizeLinear", [dc, lc]], ["Div", [dd]], ["Einsum", [Jd, el]], ["Elu", [Mu, or]], ["Equal", [ld]], ["Erf", [Ru]], ["Exp", [Uu]], ["Expand", [nl]], ["FastGelu", [il]], ["Floor", [Nu]], ["FusedConv", [Io, To]], ["Gather", [ul, sl]], ["GatherElements", [bl, gl]], ["GatherBlockQuantized", [ml, fl]], ["GatherND", [ll, cl]], ["Gelu", [Vu]], ["Gemm", [wl, _l]], ["GlobalAveragePool", [rc, tc]], ["GlobalMaxPool", [sc, ac]], ["Greater", [fd]], ["GreaterOrEqual", [gd]], ["GridSample", [$l, xl]], ["GroupQueryAttention", [Ol]], ["HardSigmoid", [ju, Ku]], ["InstanceNormalization", [Dl]], ["LayerNormalization", [Rl]], ["LeakyRelu", [Lu, or]], ["Less", [hd]], ["LessOrEqual", [bd]], ["Log", [nd]], ["MatMul", [Nl]], ["MatMulNBits", [Ll, Wl]], ["MaxPool", [oc, ic]], ["Mul", [cd]], ["MultiHeadAttention", [Cl, Il]], ["Neg", [Gu]], ["Not", [Wu]], ["Pad", [Hl]], ["Pow", [pd]], ["QuickGelu", [od, or]], ["Range", [pc]], ["Reciprocal", [Hu]], ["ReduceMin", [du]], ["ReduceMean", [ou]], ["ReduceMax", [uu]], ["ReduceSum", [cu]], ["ReduceProd", [lu]], ["ReduceL1", [iu]], ["ReduceL2", [au]], ["ReduceLogSum", [mu]], ["ReduceLogSumExp", [su]], ["ReduceSumSquare", [pu]], ["Relu", [Fu]], ["Resize", [_c, wc]], ["RotaryEmbedding", [kl]], ["ScatterND", [hc, fc]], ["Sigmoid", [qu]], ["Sin", [Zu]], ["Sinh", [Qu]], ["Slice", [Tc, Ic]], ["SkipLayerNormalization", [$c]], ["Split", [Al, El]], ["Sqrt", [Yu]], ["Softmax", [Ac, Ec]], ["Sub", [md]], ["Tan", [Xu]], ["Tanh", [ed]], ["ThresholdedRelu", [rd, or]], ["Tile", [Oc]], ["Transpose", [Fs, qs]], ["Where", [Bc]]]);
});
var mn;
var Uc = V(() => {
  "use strict";
  Le();
  nt();
  oe();
  mn = class {
    constructor(e4) {
      this.backend = e4;
      this.repo = /* @__PURE__ */ new Map(), this.attributesBound = false;
    }
    getArtifact(e4) {
      return this.repo.get(e4);
    }
    setArtifact(e4, r) {
      this.repo.set(e4, r);
    }
    run(e4, r, n, o, i) {
      Ve(e4.programInfo.name);
      let s = this.backend.device, u = this.backend.getComputePassEncoder();
      this.backend.writeTimestamp(this.backend.pendingDispatchNumber * 2);
      let d = [];
      for (let p4 of r) d.push({ binding: d.length, resource: { buffer: p4.buffer } });
      for (let p4 of n) d.push({ binding: d.length, resource: { buffer: p4.buffer } });
      i && d.push({ binding: d.length, resource: i });
      let c2 = s.createBindGroup({ layout: e4.computePipeline.getBindGroupLayout(0), entries: d, label: e4.programInfo.name });
      if (this.backend.sessionStatus === "capturing") {
        let p4 = { kernelId: this.backend.currentKernelId, computePipeline: e4.computePipeline, bindGroup: c2, dispatchGroup: o };
        this.backend.capturedCommandList.get(this.backend.currentSessionId).push(p4);
      }
      u.setPipeline(e4.computePipeline), u.setBindGroup(0, c2), u.dispatchWorkgroups(...o), this.backend.writeTimestamp(this.backend.pendingDispatchNumber * 2 + 1), this.backend.pendingDispatchNumber++, (this.backend.pendingDispatchNumber >= this.backend.maxDispatchNumber || this.backend.queryType === "at-passes") && this.backend.endComputePass(), this.backend.pendingDispatchNumber >= this.backend.maxDispatchNumber && this.backend.flush(), Re(e4.programInfo.name);
    }
    dispose() {
    }
    build(e4, r) {
      Ve(e4.name);
      let n = this.backend.device, o = [];
      [{ feature: "shader-f16", extension: "f16" }, { feature: "subgroups", extension: "subgroups" }].forEach((m) => {
        n.features.has(m.feature) && o.push(`enable ${m.extension};`);
      });
      let s = Gs(r, this.backend.device.limits), u = e4.getShaderSource(s), d = `${o.join(`
`)}
${s.additionalImplementations}
${u}`, c2 = n.createShaderModule({ code: d, label: e4.name });
      ie("verbose", () => `[WebGPU] ${e4.name} shader code: ${d}`);
      let p4 = n.createComputePipeline({ compute: { module: c2, entryPoint: "main" }, layout: "auto", label: e4.name });
      return Re(e4.name), { programInfo: e4, computePipeline: p4, uniformVariablesInfo: s.variablesInfo };
    }
    normalizeDispatchGroupSize(e4) {
      let r = typeof e4 == "number" ? e4 : e4.x, n = typeof e4 == "number" ? 1 : e4.y || 1, o = typeof e4 == "number" ? 1 : e4.z || 1, i = this.backend.device.limits.maxComputeWorkgroupsPerDimension;
      if (r <= i && n <= i && o <= i) return [r, n, o];
      let s = r * n * o, u = Math.ceil(Math.sqrt(s));
      if (u > i) {
        if (u = Math.ceil(Math.cbrt(s)), u > i) throw new Error("Total dispatch size exceeds WebGPU maximum.");
        return [u, u, u];
      } else return [u, u, 1];
    }
  };
});
var Nc = {};
Vt(Nc, { WebGpuBackend: () => Do });
var Vb;
var Lb;
var Bo;
var Do;
var Vc = V(() => {
  "use strict";
  Le();
  J();
  nt();
  oo();
  Ls();
  Rc();
  Uc();
  Vb = (t, e4) => {
    if (e4.length !== t.length) throw new Error(`inputDependencies length ${e4.length} is not equal to inputTensors length ${t.length}.`);
    let r = [];
    for (let n = 0; n < t.length; ++n) {
      let o = t[n].dataType;
      switch (e4[n]) {
        case "none": {
          r.push("");
          break;
        }
        case "type": {
          r.push(`${o}`);
          break;
        }
        case "rank": {
          let i = t[n].dims.length;
          r.push(`${o};${i}`);
          break;
        }
        case "dims": {
          let i = t[n].dims.join(",");
          r.push(`${o};${i}`);
          break;
        }
        default:
          throw new Error(`unsupported input dependency: ${e4[n]}`);
      }
    }
    return r.join("|");
  }, Lb = (t, e4, r) => {
    let n = t.name;
    return t.shaderCache?.hint && (n += "[" + t.shaderCache.hint + "]"), n += ":" + r + `:${Vb(e4, t.shaderCache?.inputDependencies ?? new Array(e4.length).fill("dims"))}`, n;
  }, Bo = class {
    constructor(e4) {
      e4 && (this.architecture = e4.architecture, this.vendor = e4.vendor);
    }
    isArchitecture(e4) {
      return this.architecture === e4;
    }
    isVendor(e4) {
      return this.vendor === e4;
    }
  }, Do = class {
    constructor() {
      this.currentSessionId = null;
      this.currentKernelId = null;
      this.commandEncoder = null;
      this.computePassEncoder = null;
      this.maxDispatchNumber = 16;
      this.pendingDispatchNumber = 0;
      this.pendingKernels = [];
      this.pendingQueries = /* @__PURE__ */ new Map();
      this.sessionStatus = "default";
      this.capturedCommandList = /* @__PURE__ */ new Map();
      this.capturedPendingKernels = /* @__PURE__ */ new Map();
      this.sessionExternalDataMapping = /* @__PURE__ */ new Map();
    }
    get currentKernelCustomData() {
      if (this.currentKernelId === null) throw new Error("currentKernelCustomData(): currentKernelId is null. (should not happen)");
      let e4 = this.kernelCustomData.get(this.currentKernelId);
      return e4 || (e4 = {}, this.kernelCustomData.set(this.currentKernelId, e4)), e4;
    }
    async initialize(e4, r) {
      this.env = e4;
      let n = [], o = { requiredLimits: { maxComputeWorkgroupStorageSize: r.limits.maxComputeWorkgroupStorageSize, maxComputeWorkgroupsPerDimension: r.limits.maxComputeWorkgroupsPerDimension, maxStorageBufferBindingSize: r.limits.maxStorageBufferBindingSize, maxBufferSize: r.limits.maxBufferSize, maxComputeInvocationsPerWorkgroup: r.limits.maxComputeInvocationsPerWorkgroup, maxComputeWorkgroupSizeX: r.limits.maxComputeWorkgroupSizeX, maxComputeWorkgroupSizeY: r.limits.maxComputeWorkgroupSizeY, maxComputeWorkgroupSizeZ: r.limits.maxComputeWorkgroupSizeZ }, requiredFeatures: n }, i = (d) => r.features.has(d) && n.push(d) && true;
      i("chromium-experimental-timestamp-query-inside-passes") || i("timestamp-query"), i("shader-f16"), i("subgroups"), this.device = await r.requestDevice(o);
      let s = r, u = r.info ?? (typeof s.requestAdapterInfo == "function" ? await s.requestAdapterInfo() : void 0);
      this.adapterInfo = new Bo(u), this.gpuDataManager = Vs(this), this.programManager = new mn(this), this.kernels = /* @__PURE__ */ new Map(), this.kernelPersistentData = /* @__PURE__ */ new Map(), this.kernelCustomData = /* @__PURE__ */ new Map(), Lr(e4.logLevel, !!e4.debug), this.device.onuncapturederror = (d) => {
        d.error instanceof GPUValidationError && console.error(`An uncaught WebGPU validation error was raised: ${d.error.message}`);
      }, Object.defineProperty(this.env.webgpu, "device", { value: this.device, writable: false, enumerable: true, configurable: true }), Object.defineProperty(this.env.webgpu, "adapter", { value: r, writable: false, enumerable: true, configurable: false }), this.setQueryType();
    }
    dispose() {
      typeof this.querySet < "u" && this.querySet.destroy(), this.gpuDataManager.dispose(), this.device && this.env?.webgpu && this.device.lost.then(() => {
        delete this.env.webgpu.device;
      });
    }
    getCommandEncoder() {
      return this.commandEncoder || (this.commandEncoder = this.device.createCommandEncoder()), this.commandEncoder;
    }
    getComputePassEncoder() {
      if (!this.computePassEncoder) {
        let e4 = this.getCommandEncoder(), r = {};
        this.queryType === "at-passes" && (r.timestampWrites = { querySet: this.querySet, beginningOfPassWriteIndex: this.pendingDispatchNumber * 2, endOfPassWriteIndex: this.pendingDispatchNumber * 2 + 1 }), this.computePassEncoder = e4.beginComputePass(r);
      }
      return this.computePassEncoder;
    }
    endComputePass() {
      this.computePassEncoder && (this.computePassEncoder.end(), this.computePassEncoder = null);
    }
    flush() {
      if (!this.commandEncoder) return;
      Ve(), this.endComputePass();
      let e4;
      this.queryType !== "none" && (this.commandEncoder.resolveQuerySet(this.querySet, 0, this.pendingDispatchNumber * 2, this.queryResolveBuffer, 0), e4 = this.device.createBuffer({ size: this.pendingDispatchNumber * 2 * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), this.pendingQueries.set(e4, this.pendingKernels), this.pendingKernels = [], this.commandEncoder.copyBufferToBuffer(this.queryResolveBuffer, 0, e4, 0, this.pendingDispatchNumber * 2 * 8)), this.device.queue.submit([this.commandEncoder.finish()]), this.gpuDataManager.refreshPendingBuffers(), this.commandEncoder = null, this.pendingDispatchNumber = 0, this.queryType !== "none" && e4.mapAsync(GPUMapMode.READ).then(() => {
        let r = new BigUint64Array(e4.getMappedRange()), n = this.pendingQueries.get(e4);
        for (let o = 0; o < r.length / 2; o++) {
          let i = n[o], s = i.kernelId, u = this.kernels.get(s), d = u.kernelType, c2 = u.kernelName, p4 = i.programName, m = i.inputTensorViews, g = i.outputTensorViews, y = r[o * 2], b = r[o * 2 + 1];
          typeof this.queryTimeBase > "u" && (this.queryTimeBase = y);
          let _ = Number(y - this.queryTimeBase), T = Number(b - this.queryTimeBase);
          if (!Number.isSafeInteger(_) || !Number.isSafeInteger(T)) throw new RangeError("incorrect timestamp range");
          if (this.env.webgpu.profiling?.ondata) this.env.webgpu.profiling.ondata({ version: 1, inputsMetadata: m.map((x) => ({ dims: x.dims, dataType: rt(x.dataType) })), outputsMetadata: g.map((x) => ({ dims: x.dims, dataType: rt(x.dataType) })), kernelId: s, kernelType: d, kernelName: c2, programName: p4, startTime: _, endTime: T });
          else {
            let x = "";
            m.forEach((S, I) => {
              x += `input[${I}]: [${S.dims}] | ${rt(S.dataType)}, `;
            });
            let $ = "";
            g.forEach((S, I) => {
              $ += `output[${I}]: [${S.dims}] | ${rt(S.dataType)}, `;
            }), console.log(`[profiling] kernel "${s}|${d}|${c2}|${p4}" ${x}${$}start time: ${_} ns, execution time: ${T - _} ns`);
          }
          Tr("GPU", `${p4}::${y}::${b}`);
        }
        e4.unmap(), this.pendingQueries.delete(e4);
      }), Re();
    }
    run(e4, r, n, o, i, s) {
      Ve(e4.name);
      let u = [];
      for (let S = 0; S < r.length; ++S) {
        let I = r[S].data;
        if (I === 0) continue;
        let E = this.gpuDataManager.get(I);
        if (!E) throw new Error(`no GPU data for input: ${I}`);
        u.push(E);
      }
      let { outputs: d, dispatchGroup: c2, programUniforms: p4 } = e4.getRunData(r), m = n.length === 0 ? d.map((S, I) => I) : n;
      if (m.length !== d.length) throw new Error(`Output size ${m.length} must be equal to ${d.length}.`);
      let g = [], y = [];
      for (let S = 0; S < d.length; ++S) {
        if (!Number.isInteger(m[S]) || m[S] < -3 || m[S] >= s) throw new Error(`Invalid output index: ${m[S]}`);
        if (m[S] === -3) continue;
        let I = m[S] === -1, E = m[S] === -2, A = I || E ? i(d[S].dataType, d[S].dims) : o(m[S], d[S].dataType, d[S].dims);
        if (g.push(A), A.data === 0) continue;
        let z = this.gpuDataManager.get(A.data);
        if (!z) throw new Error(`no GPU data for output: ${A.data}`);
        if (I && this.temporaryData.push(z), E) {
          let v = this.kernelPersistentData.get(this.currentKernelId);
          v || (v = [], this.kernelPersistentData.set(this.currentKernelId, v)), v.push(z);
        }
        y.push(z);
      }
      if (u.length !== r.length || y.length !== g.length) {
        if (y.length === 0) return Re(e4.name), g;
        throw new Error(`Program ${e4.name} has zero-sized tensor(s) in inputs or outputs. This is not supported now.`);
      }
      let b;
      if (p4) {
        let S = 0, I = [];
        p4.forEach((v) => {
          let R = typeof v.data == "number" ? [v.data] : v.data;
          if (R.length === 0) return;
          let N = v.type === 10 ? 2 : 4, F, q;
          v.type === 10 ? (q = R.length > 4 ? 16 : R.length > 2 ? 8 : R.length * N, F = R.length > 4 ? 16 : N * R.length) : (q = R.length <= 2 ? R.length * N : 16, F = 16), S = Math.ceil(S / q) * q, I.push(S);
          let X = v.type === 10 ? 8 : 4;
          S += R.length > 4 ? Math.ceil(R.length / X) * F : R.length * N;
        });
        let E = 16;
        S = Math.ceil(S / E) * E;
        let A = new ArrayBuffer(S);
        p4.forEach((v, R) => {
          let N = I[R], F = typeof v.data == "number" ? [v.data] : v.data;
          if (v.type === 6) new Int32Array(A, N, F.length).set(F);
          else if (v.type === 12) new Uint32Array(A, N, F.length).set(F);
          else if (v.type === 10) new Uint16Array(A, N, F.length).set(F);
          else if (v.type === 1) new Float32Array(A, N, F.length).set(F);
          else throw new Error(`Unsupported uniform type: ${rt(v.type)}`);
        });
        let z = this.gpuDataManager.create(S, GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM);
        this.device.queue.writeBuffer(z.buffer, 0, A, 0, S), this.gpuDataManager.release(z.id), b = { offset: 0, size: S, buffer: z.buffer };
      }
      let _ = this.programManager.normalizeDispatchGroupSize(c2), T = _[1] === 1 && _[2] === 1, x = Lb(e4, r, T), $ = this.programManager.getArtifact(x);
      if ($ || ($ = this.programManager.build(e4, _), this.programManager.setArtifact(x, $), ie("info", () => `[artifact] key: ${x}, programName: ${e4.name}`)), p4 && $.uniformVariablesInfo) {
        if (p4.length !== $.uniformVariablesInfo.length) throw new Error(`Uniform variables count mismatch: expect ${$.uniformVariablesInfo.length}, got ${p4.length} in program "${$.programInfo.name}".`);
        for (let S = 0; S < p4.length; S++) {
          let I = p4[S], E = I.type, A = typeof I.data == "number" ? 1 : I.data.length, [z, v] = $.uniformVariablesInfo[S];
          if (E !== z || A !== v) throw new Error(`Uniform variable ${S} mismatch: expect type ${z} with size ${v}, got type ${E} with size ${A} in program "${$.programInfo.name}".`);
        }
      }
      if (ie("info", () => `[ProgramManager] run "${e4.name}" (key=${x}) with ${_[0]}x${_[1]}x${_[2]}`), this.queryType !== "none" || this.sessionStatus === "capturing") {
        let S = { kernelId: this.currentKernelId, programName: $.programInfo.name, inputTensorViews: r, outputTensorViews: g };
        this.pendingKernels.push(S), this.sessionStatus === "capturing" && this.capturedPendingKernels.get(this.currentSessionId).push(S);
      }
      return this.programManager.run($, u, y, _, b), Re(e4.name), g;
    }
    upload(e4, r) {
      this.gpuDataManager.upload(e4, r);
    }
    memcpy(e4, r) {
      this.gpuDataManager.memcpy(e4, r);
    }
    async download(e4, r) {
      await this.gpuDataManager.download(e4, r);
    }
    alloc(e4) {
      return this.gpuDataManager.create(e4).id;
    }
    free(e4) {
      return this.gpuDataManager.release(e4);
    }
    createKernel(e4, r, n, o) {
      let i = Mc.get(e4);
      if (!i) throw new Error(`kernel not implemented: ${e4}`);
      let s = { kernelType: e4, kernelName: o, kernelEntry: i[0], attributes: [i[1], n] };
      this.kernels.set(r, s);
    }
    releaseKernel(e4) {
      let r = this.kernelPersistentData.get(e4);
      if (r) {
        for (let n of r) this.gpuDataManager.release(n.id);
        this.kernelPersistentData.delete(e4);
      }
      this.kernelCustomData.delete(e4), this.kernels.delete(e4);
    }
    computeKernel(e4, r, n) {
      let o = this.kernels.get(e4);
      if (!o) throw new Error(`kernel not created: ${e4}`);
      let i = o.kernelType, s = o.kernelName, u = o.kernelEntry, d = o.attributes;
      if (this.currentKernelId !== null) throw new Error(`kernel "[${i}] ${s}" is not allowed to be called recursively`);
      this.currentKernelId = e4, d[0] && (d[1] = d[0](d[1]), d[0] = void 0), ie("info", () => `[WebGPU] Start to run kernel "[${i}] ${s}"...`);
      let c2 = this.env.debug;
      this.temporaryData = [];
      try {
        return c2 && this.device.pushErrorScope("validation"), u(r, d[1]), 0;
      } catch (p4) {
        return n.push(Promise.resolve(`[WebGPU] Kernel "[${i}] ${s}" failed. ${p4}`)), 1;
      } finally {
        c2 && n.push(this.device.popErrorScope().then((p4) => p4 ? `GPU validation error for kernel "[${i}] ${s}": ${p4.message}` : null));
        for (let p4 of this.temporaryData) this.gpuDataManager.release(p4.id);
        this.temporaryData = [], this.currentKernelId = null;
      }
    }
    registerBuffer(e4, r, n, o) {
      let i = this.sessionExternalDataMapping.get(e4);
      i || (i = /* @__PURE__ */ new Map(), this.sessionExternalDataMapping.set(e4, i));
      let s = i.get(r), u = this.gpuDataManager.registerExternalBuffer(n, o, s);
      return i.set(r, [u, n]), u;
    }
    unregisterBuffers(e4) {
      let r = this.sessionExternalDataMapping.get(e4);
      r && (r.forEach((n) => this.gpuDataManager.unregisterExternalBuffer(n[0])), this.sessionExternalDataMapping.delete(e4));
    }
    getBuffer(e4) {
      let r = this.gpuDataManager.get(e4);
      if (!r) throw new Error(`no GPU data for buffer: ${e4}`);
      return r.buffer;
    }
    createDownloader(e4, r, n) {
      return async () => {
        let o = await co(this, e4, r);
        return Gr(o.buffer, n);
      };
    }
    writeTimestamp(e4) {
      this.queryType === "inside-passes" && this.computePassEncoder.writeTimestamp(this.querySet, e4);
    }
    setQueryType() {
      this.queryType = "none", (this.env.webgpu.profiling?.mode === "default" || (typeof this.env.trace > "u" ? this.env.wasm.trace : this.env.trace)) && (this.device.features.has("chromium-experimental-timestamp-query-inside-passes") ? this.queryType = "inside-passes" : this.device.features.has("timestamp-query") && (this.queryType = "at-passes"), this.queryType !== "none" && typeof this.querySet > "u" && (this.querySet = this.device.createQuerySet({ type: "timestamp", count: this.maxDispatchNumber * 2 }), this.queryResolveBuffer = this.device.createBuffer({ size: this.maxDispatchNumber * 2 * 8, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.QUERY_RESOLVE })));
    }
    captureBegin() {
      ie("info", "captureBegin"), this.capturedCommandList.get(this.currentSessionId) || this.capturedCommandList.set(this.currentSessionId, []), this.capturedPendingKernels.get(this.currentSessionId) || this.capturedPendingKernels.set(this.currentSessionId, []), this.flush(), this.sessionStatus = "capturing";
    }
    captureEnd() {
      ie("info", "captureEnd"), this.flush(), this.sessionStatus = "default";
    }
    replay() {
      ie("info", "replay"), this.sessionStatus = "replaying";
      let e4 = this.capturedCommandList.get(this.currentSessionId), r = this.capturedPendingKernels.get(this.currentSessionId), n = e4.length;
      this.pendingKernels = [];
      for (let o = 0; o < n; o++) {
        let i = this.getComputePassEncoder(), s = e4[o];
        this.writeTimestamp(this.pendingDispatchNumber * 2), i.setPipeline(s.computePipeline), i.setBindGroup(0, s.bindGroup), i.dispatchWorkgroups(...s.dispatchGroup), this.writeTimestamp(this.pendingDispatchNumber * 2 + 1), this.pendingDispatchNumber++, this.queryType !== "none" && this.pendingKernels.push(r[o]), (this.pendingDispatchNumber >= this.maxDispatchNumber || this.queryType === "at-passes") && this.endComputePass(), this.pendingDispatchNumber >= this.maxDispatchNumber && this.flush();
      }
      this.flush(), this.sessionStatus = "default";
    }
    onCreateSession() {
      this.gpuDataManager.onCreateSession();
    }
    onReleaseSession(e4) {
      this.unregisterBuffers(e4), this.capturedCommandList.has(e4) && this.capturedCommandList.delete(e4), this.capturedPendingKernels.has(e4) && this.capturedPendingKernels.delete(e4), this.gpuDataManager.onReleaseSession(e4);
    }
    onRunStart(e4) {
      this.currentSessionId = e4, this.setQueryType();
    }
  };
});
var Lc = {};
Vt(Lc, { init: () => Wb });
var ur;
var Mo;
var Wb;
var Wc = V(() => {
  "use strict";
  J();
  nt();
  re();
  Ms();
  ur = class t {
    constructor(e4, r, n, o) {
      this.module = e4;
      this.dataType = r;
      this.data = n;
      this.dims = o;
    }
    getFloat32Array() {
      if (this.dataType !== 1) throw new Error("Invalid data type");
      let e4 = k4.size(this.dims);
      return e4 === 0 ? new Float32Array() : new Float32Array(this.module.HEAP8.buffer, this.data, e4);
    }
    getBigInt64Array() {
      if (this.dataType !== 7) throw new Error("Invalid data type");
      let e4 = k4.size(this.dims);
      return e4 === 0 ? new BigInt64Array() : new BigInt64Array(this.module.HEAP8.buffer, this.data, e4);
    }
    getInt32Array() {
      if (this.dataType !== 6) throw new Error("Invalid data type");
      let e4 = k4.size(this.dims);
      return e4 === 0 ? new Int32Array() : new Int32Array(this.module.HEAP8.buffer, this.data, e4);
    }
    getUint16Array() {
      if (this.dataType !== 10 && this.dataType !== 4) throw new Error("Invalid data type");
      let e4 = k4.size(this.dims);
      return e4 === 0 ? new Uint16Array() : new Uint16Array(this.module.HEAP8.buffer, this.data, e4);
    }
    reshape(e4) {
      if (k4.size(e4) !== k4.size(this.dims)) throw new Error("Invalid new shape");
      return new t(this.module, this.dataType, this.data, e4);
    }
  }, Mo = class {
    constructor(e4, r, n) {
      this.module = e4;
      this.backend = r;
      this.customDataOffset = 0;
      this.customDataSize = 0;
      this.adapterInfo = r.adapterInfo;
      let o = e4.PTR_SIZE, i = n / e4.PTR_SIZE, s = o === 4 ? "i32" : "i64";
      this.opKernelContext = Number(e4.getValue(o * i++, s));
      let u = Number(e4.getValue(o * i++, s));
      this.outputCount = Number(e4.getValue(o * i++, s)), this.customDataOffset = Number(e4.getValue(o * i++, "*")), this.customDataSize = Number(e4.getValue(o * i++, s));
      let d = [];
      for (let c2 = 0; c2 < u; c2++) {
        let p4 = Number(e4.getValue(o * i++, s)), m = Number(e4.getValue(o * i++, "*")), g = Number(e4.getValue(o * i++, s)), y = [];
        for (let b = 0; b < g; b++) y.push(Number(e4.getValue(o * i++, s)));
        d.push(new ur(e4, p4, m, y));
      }
      this.inputs = d;
    }
    get kernelCustomData() {
      return this.backend.currentKernelCustomData;
    }
    get customDataBuffer() {
      return this.module.HEAPU8.subarray(this.customDataOffset, this.customDataOffset + this.customDataSize);
    }
    compute(e4, r) {
      let n = r?.inputs?.map((u) => typeof u == "number" ? this.inputs[u] : u) ?? this.inputs, o = r?.outputs ?? [], i = (u, d, c2) => new ur(this.module, d, this.output(u, c2), c2), s = (u, d) => {
        let c2 = xt(u, d);
        if (!c2) throw new Error(`Unsupported data type: ${u}`);
        let p4 = c2 > 0 ? this.backend.gpuDataManager.create(c2).id : 0;
        return new ur(this.module, u, p4, d);
      };
      return this.backend.run(e4, n, o, i, s, this.outputCount);
    }
    output(e4, r) {
      let n = this.module.stackSave();
      try {
        let o = this.module.PTR_SIZE, i = o === 4 ? "i32" : "i64", s = this.module.stackAlloc((1 + r.length) * o);
        this.module.setValue(s, r.length, i);
        for (let u = 0; u < r.length; u++) this.module.setValue(s + o * (u + 1), r[u], i);
        return this.module._JsepOutput(this.opKernelContext, e4, s);
      } catch (o) {
        throw new Error(`Failed to generate kernel's output[${e4}] with dims [${r}]. If you are running with pre-allocated output, please make sure the output type/dims are correct. Error: ${o}`);
      } finally {
        this.module.stackRestore(n);
      }
    }
  }, Wb = async (t, e4, r, n) => {
    let o = e4.jsepInit;
    if (!o) throw new Error("Failed to initialize JSEP. The WebAssembly module is not built with JSEP support.");
    if (t === "webgpu") {
      let i = (Vc(), Xt(Nc)).WebGpuBackend, s = new i();
      await s.initialize(r, n), o("webgpu", [s, (u) => s.alloc(Number(u)), (u) => s.free(u), (u, d, c2, p4 = false) => {
        if (p4) ie("verbose", () => `[WebGPU] jsepCopyGpuToGpu: src=${Number(u)}, dst=${Number(d)}, size=${Number(c2)}`), s.memcpy(Number(u), Number(d));
        else {
          ie("verbose", () => `[WebGPU] jsepCopyCpuToGpu: dataOffset=${Number(u)}, gpuDataId=${Number(d)}, size=${Number(c2)}`);
          let m = e4.HEAPU8.subarray(Number(u >>> 0), Number(u >>> 0) + Number(c2));
          s.upload(Number(d), m);
        }
      }, async (u, d, c2) => {
        ie("verbose", () => `[WebGPU] jsepCopyGpuToCpu: gpuDataId=${u}, dataOffset=${d}, size=${c2}`), await s.download(Number(u), () => e4.HEAPU8.subarray(Number(d) >>> 0, Number(d + c2) >>> 0));
      }, (u, d, c2) => s.createKernel(u, Number(d), c2, e4.UTF8ToString(e4._JsepGetNodeName(Number(d)))), (u) => s.releaseKernel(u), (u, d, c2, p4) => {
        ie("verbose", () => `[WebGPU] jsepRun: sessionHandle=${c2}, kernel=${u}, contextDataOffset=${d}`);
        let m = new Mo(e4, s, Number(d));
        return s.computeKernel(Number(u), m, p4);
      }, () => s.captureBegin(), () => s.captureEnd(), () => s.replay()]);
    } else {
      let i = new Kr(r);
      o("webnn", [i, () => i.reserveTensorId(), (s) => i.releaseTensorId(s), async (s, u, d, c2, p4) => i.ensureTensor(s, u, d, c2, p4), (s, u) => {
        i.uploadTensor(s, u);
      }, async (s, u) => i.downloadTensor(s, u), (s, u) => i.registerMLContext(s, u), !!r.trace]);
    }
  };
});
var Gb;
var kr;
var Pr;
var Mt;
var Hb;
var Gc;
var er;
var Or;
var zr;
var Hc;
var Br;
var Dr;
var Mr;
var Qn = V(() => {
  "use strict";
  Le();
  xs();
  Ts();
  J();
  vt();
  Ur();
  ro();
  Gb = (t, e4) => {
    ye()._OrtInit(t, e4) !== 0 && me("Can't initialize onnxruntime.");
  }, kr = async (t) => {
    Gb(t.wasm.numThreads, rr(t.logLevel));
  }, Pr = async (t, e4) => {
    ye().asyncInit?.();
    let r = t.webgpu.adapter;
    if (e4 === "webgpu") {
      if (typeof navigator > "u" || !navigator.gpu) throw new Error("WebGPU is not supported in current environment");
      if (r) {
        if (typeof r.limits != "object" || typeof r.features != "object" || typeof r.requestDevice != "function") throw new Error("Invalid GPU adapter set in `env.webgpu.adapter`. It must be a GPUAdapter object.");
      } else {
        let n = t.webgpu.powerPreference;
        if (n !== void 0 && n !== "low-power" && n !== "high-performance") throw new Error(`Invalid powerPreference setting: "${n}"`);
        let o = t.webgpu.forceFallbackAdapter;
        if (o !== void 0 && typeof o != "boolean") throw new Error(`Invalid forceFallbackAdapter setting: "${o}"`);
        if (r = await navigator.gpu.requestAdapter({ powerPreference: n, forceFallbackAdapter: o }), !r) throw new Error('Failed to get GPU adapter. You may need to enable flag "--enable-unsafe-webgpu" if you are using Chrome.');
      }
    }
    if (e4 === "webnn" && (typeof navigator > "u" || !navigator.ml)) throw new Error("WebNN is not supported in current environment");
    {
      let n = (Wc(), Xt(Lc)).init;
      e4 === "webgpu" && await n("webgpu", ye(), t, r), e4 === "webnn" && await n("webnn", ye(), t);
    }
  }, Mt = /* @__PURE__ */ new Map(), Hb = (t) => {
    let e4 = ye(), r = e4.stackSave();
    try {
      let n = e4.PTR_SIZE, o = e4.stackAlloc(2 * n);
      e4._OrtGetInputOutputCount(t, o, o + n) !== 0 && me("Can't get session input/output count.");
      let s = n === 4 ? "i32" : "i64";
      return [Number(e4.getValue(o, s)), Number(e4.getValue(o + n, s))];
    } finally {
      e4.stackRestore(r);
    }
  }, Gc = (t, e4) => {
    let r = ye(), n = r.stackSave(), o = 0;
    try {
      let i = r.PTR_SIZE, s = r.stackAlloc(2 * i);
      r._OrtGetInputOutputMetadata(t, e4, s, s + i) !== 0 && me("Can't get session input/output metadata.");
      let d = Number(r.getValue(s, "*"));
      o = Number(r.getValue(s + i, "*"));
      let c2 = r.HEAP32[o / 4];
      if (c2 === 0) return [d, 0];
      let p4 = r.HEAPU32[o / 4 + 1], m = [];
      for (let g = 0; g < p4; g++) {
        let y = Number(r.getValue(o + 8 + g * i, "*"));
        m.push(y !== 0 ? r.UTF8ToString(y) : Number(r.getValue(o + 8 + (g + p4) * i, "*")));
      }
      return [d, c2, m];
    } finally {
      r.stackRestore(n), o !== 0 && r._OrtFree(o);
    }
  }, er = (t) => {
    let e4 = ye(), r = e4._malloc(t.byteLength);
    if (r === 0) throw new Error(`Can't create a session. failed to allocate a buffer of size ${t.byteLength}.`);
    return e4.HEAPU8.set(t, r), [r, t.byteLength];
  }, Or = async (t, e4) => {
    let r, n, o = ye();
    Array.isArray(t) ? [r, n] = t : t.buffer === o.HEAPU8.buffer ? [r, n] = [t.byteOffset, t.byteLength] : [r, n] = er(t);
    let i = 0, s = 0, u = 0, d = [], c2 = [], p4 = [];
    try {
      if ([s, d] = await Ss(e4), e4?.externalData && o.mountExternalData) {
        let I = [];
        for (let E of e4.externalData) {
          let A = typeof E == "string" ? E : E.path;
          I.push(nr(typeof E == "string" ? E : E.data).then((z) => {
            o.mountExternalData(A, z);
          }));
        }
        await Promise.all(I);
      }
      for (let I of e4?.executionProviders ?? []) if ((typeof I == "string" ? I : I.name) === "webnn") {
        if (o.shouldTransferToMLTensor = false, typeof I != "string") {
          let A = I, z = A?.context, v = A?.gpuDevice, R = A?.deviceType, N = A?.powerPreference;
          z ? o.currentContext = z : v ? o.currentContext = await o.webnnCreateMLContext(v) : o.currentContext = await o.webnnCreateMLContext({ deviceType: R, powerPreference: N });
        } else o.currentContext = await o.webnnCreateMLContext();
        break;
      }
      i = await o._OrtCreateSession(r, n, s), o.webgpuOnCreateSession?.(i), i === 0 && me("Can't create a session."), o.jsepOnCreateSession?.(), o.currentContext && (o.webnnRegisterMLContext(i, o.currentContext), o.currentContext = void 0, o.shouldTransferToMLTensor = true);
      let [m, g] = Hb(i), y = !!e4?.enableGraphCapture, b = [], _ = [], T = [], x = [], $ = [];
      for (let I = 0; I < m; I++) {
        let [E, A, z] = Gc(i, I);
        E === 0 && me("Can't get an input name."), c2.push(E);
        let v = o.UTF8ToString(E);
        b.push(v), T.push(A === 0 ? { name: v, isTensor: false } : { name: v, isTensor: true, type: rt(A), shape: z });
      }
      for (let I = 0; I < g; I++) {
        let [E, A, z] = Gc(i, I + m);
        E === 0 && me("Can't get an output name."), p4.push(E);
        let v = o.UTF8ToString(E);
        _.push(v), x.push(A === 0 ? { name: v, isTensor: false } : { name: v, isTensor: true, type: rt(A), shape: z });
        {
          if (y && e4?.preferredOutputLocation === void 0) {
            $.push("gpu-buffer");
            continue;
          }
          let R = typeof e4?.preferredOutputLocation == "string" ? e4.preferredOutputLocation : e4?.preferredOutputLocation?.[v] ?? "cpu", N = o.webnnIsGraphOutput;
          if (R === "cpu" && N && N(i, v)) {
            $.push("ml-tensor-cpu-output");
            continue;
          }
          if (R !== "cpu" && R !== "cpu-pinned" && R !== "gpu-buffer" && R !== "ml-tensor") throw new Error(`Not supported preferred output location: ${R}.`);
          if (y && R !== "gpu-buffer") throw new Error(`Not supported preferred output location: ${R}. Only 'gpu-buffer' location is supported when enableGraphCapture is true.`);
          $.push(R);
        }
      }
      let S = null;
      return $.some((I) => I === "gpu-buffer" || I === "ml-tensor" || I === "ml-tensor-cpu-output") && (u = o._OrtCreateBinding(i), u === 0 && me("Can't create IO binding."), S = { handle: u, outputPreferredLocations: $, outputPreferredLocationsEncoded: $.map((I) => I === "ml-tensor-cpu-output" ? "ml-tensor" : I).map((I) => to(I)) }), Mt.set(i, [i, c2, p4, S, y, false]), [i, b, _, T, x];
    } catch (m) {
      throw c2.forEach((g) => o._OrtFree(g)), p4.forEach((g) => o._OrtFree(g)), u !== 0 && o._OrtReleaseBinding(u) !== 0 && me("Can't release IO binding."), i !== 0 && o._OrtReleaseSession(i) !== 0 && me("Can't release session."), m;
    } finally {
      o._free(r), s !== 0 && o._OrtReleaseSessionOptions(s) !== 0 && me("Can't release session options."), d.forEach((m) => o._free(m)), o.unmountExternalData?.();
    }
  }, zr = (t) => {
    let e4 = ye(), r = Mt.get(t);
    if (!r) throw new Error(`cannot release session. invalid session id: ${t}`);
    let [n, o, i, s, u] = r;
    s && (u && e4._OrtClearBoundOutputs(s.handle) !== 0 && me("Can't clear bound outputs."), e4._OrtReleaseBinding(s.handle) !== 0 && me("Can't release IO binding.")), e4.jsepOnReleaseSession?.(t), e4.webnnOnReleaseSession?.(t), e4.webgpuOnReleaseSession?.(t), o.forEach((d) => e4._OrtFree(d)), i.forEach((d) => e4._OrtFree(d)), e4._OrtReleaseSession(n) !== 0 && me("Can't release session."), Mt.delete(t);
  }, Hc = async (t, e4, r, n, o, i, s = false) => {
    if (!t) {
      e4.push(0);
      return;
    }
    let u = ye(), d = u.PTR_SIZE, c2 = t[0], p4 = t[1], m = t[3], g = m, y, b;
    if (c2 === "string" && (m === "gpu-buffer" || m === "ml-tensor")) throw new Error("String tensor is not supported on GPU.");
    if (s && m !== "gpu-buffer") throw new Error(`External buffer must be provided for input/output index ${i} when enableGraphCapture is true.`);
    if (m === "gpu-buffer") {
      let x = t[2].gpuBuffer;
      b = xt($t(c2), p4);
      {
        let $ = u.jsepRegisterBuffer;
        if (!$) throw new Error('Tensor location "gpu-buffer" is not supported without using WebGPU.');
        y = $(n, i, x, b);
      }
    } else if (m === "ml-tensor") {
      let x = t[2].mlTensor;
      b = xt($t(c2), p4);
      let $ = u.webnnRegisterMLTensor;
      if (!$) throw new Error('Tensor location "ml-tensor" is not supported without using WebNN.');
      y = $(n, x, $t(c2), p4);
    } else {
      let x = t[2];
      if (Array.isArray(x)) {
        b = d * x.length, y = u._malloc(b), r.push(y);
        for (let $ = 0; $ < x.length; $++) {
          if (typeof x[$] != "string") throw new TypeError(`tensor data at index ${$} is not a string`);
          u.setValue(y + $ * d, Ge(x[$], r), "*");
        }
      } else {
        let $ = u.webnnIsGraphInput, S = u.webnnIsGraphOutput;
        if (c2 !== "string" && $ && S) {
          let I = u.UTF8ToString(o);
          if ($(n, I) || S(n, I)) {
            let E = $t(c2);
            b = xt(E, p4), g = "ml-tensor";
            let A = u.webnnCreateTemporaryTensor, z = u.webnnUploadTensor;
            if (!A || !z) throw new Error('Tensor location "ml-tensor" is not supported without using WebNN.');
            let v = await A(n, E, p4);
            z(v, new Uint8Array(x.buffer, x.byteOffset, x.byteLength)), y = v;
          } else b = x.byteLength, y = u._malloc(b), r.push(y), u.HEAPU8.set(new Uint8Array(x.buffer, x.byteOffset, b), y);
        } else b = x.byteLength, y = u._malloc(b), r.push(y), u.HEAPU8.set(new Uint8Array(x.buffer, x.byteOffset, b), y);
      }
    }
    let _ = u.stackSave(), T = u.stackAlloc(4 * p4.length);
    try {
      p4.forEach(($, S) => u.setValue(T + S * d, $, d === 4 ? "i32" : "i64"));
      let x = u._OrtCreateTensor($t(c2), y, b, T, p4.length, to(g));
      x === 0 && me(`Can't create tensor for input/output. session=${n}, index=${i}.`), e4.push(x);
    } finally {
      u.stackRestore(_);
    }
  }, Br = async (t, e4, r, n, o, i) => {
    let s = ye(), u = s.PTR_SIZE, d = Mt.get(t);
    if (!d) throw new Error(`cannot run inference. invalid session id: ${t}`);
    let c2 = d[0], p4 = d[1], m = d[2], g = d[3], y = d[4], b = d[5], _ = e4.length, T = n.length, x = 0, $ = [], S = [], I = [], E = [], A = [], z = s.stackSave(), v = s.stackAlloc(_ * u), R = s.stackAlloc(_ * u), N = s.stackAlloc(T * u), F = s.stackAlloc(T * u);
    try {
      [x, $] = $s(i), _t("wasm prepareInputOutputTensor");
      for (let L = 0; L < _; L++) await Hc(r[L], S, E, t, p4[e4[L]], e4[L], y);
      for (let L = 0; L < T; L++) await Hc(o[L], I, E, t, m[n[L]], _ + n[L], y);
      wt("wasm prepareInputOutputTensor");
      for (let L = 0; L < _; L++) s.setValue(v + L * u, S[L], "*"), s.setValue(R + L * u, p4[e4[L]], "*");
      for (let L = 0; L < T; L++) s.setValue(N + L * u, I[L], "*"), s.setValue(F + L * u, m[n[L]], "*");
      if (g && !b) {
        let { handle: L, outputPreferredLocations: Q, outputPreferredLocationsEncoded: Y } = g;
        if (p4.length !== _) throw new Error(`input count from feeds (${_}) is expected to be always equal to model's input count (${p4.length}).`);
        _t("wasm bindInputsOutputs");
        for (let Z = 0; Z < _; Z++) {
          let te = e4[Z];
          await s._OrtBindInput(L, p4[te], S[Z]) !== 0 && me(`Can't bind input[${Z}] for session=${t}.`);
        }
        for (let Z = 0; Z < T; Z++) {
          let te = n[Z];
          o[Z]?.[3] ? (A.push(I[Z]), s._OrtBindOutput(L, m[te], I[Z], 0) !== 0 && me(`Can't bind pre-allocated output[${Z}] for session=${t}.`)) : s._OrtBindOutput(L, m[te], 0, Y[te]) !== 0 && me(`Can't bind output[${Z}] to ${Q[Z]} for session=${t}.`);
        }
        wt("wasm bindInputsOutputs"), Mt.set(t, [c2, p4, m, g, y, true]);
      }
      s.jsepOnRunStart?.(c2), s.webnnOnRunStart?.(c2);
      let q;
      g ? q = await s._OrtRunWithBinding(c2, g.handle, T, N, x) : q = await s._OrtRun(c2, R, v, _, F, T, N, x), q !== 0 && me("failed to call OrtRun().");
      let X = [], B = [];
      _t("wasm ProcessOutputTensor");
      for (let L = 0; L < T; L++) {
        let Q = Number(s.getValue(N + L * u, "*"));
        if (Q === I[L] || A.includes(I[L])) {
          X.push(o[L]), Q !== I[L] && s._OrtReleaseTensor(Q) !== 0 && me("Can't release tensor.");
          continue;
        }
        let Y = s.stackSave(), Z = s.stackAlloc(4 * u), te = false, ae, le = 0;
        try {
          s._OrtGetTensorData(Q, Z, Z + u, Z + 2 * u, Z + 3 * u) !== 0 && me(`Can't access output tensor data on index ${L}.`);
          let ve = u === 4 ? "i32" : "i64", M3 = Number(s.getValue(Z, ve));
          le = s.getValue(Z + u, "*");
          let G = s.getValue(Z + u * 2, "*"), be = Number(s.getValue(Z + u * 3, ve)), Ee = [];
          for (let he = 0; he < be; he++) Ee.push(Number(s.getValue(G + he * u, ve)));
          s._OrtFree(G) !== 0 && me("Can't free memory for tensor dims.");
          let $e = Ee.reduce((he, Te) => he * Te, 1);
          ae = rt(M3);
          let Pe = g?.outputPreferredLocations[n[L]];
          if (ae === "string") {
            if (Pe === "gpu-buffer" || Pe === "ml-tensor") throw new Error("String tensor is not supported on GPU.");
            let he = [];
            for (let Te = 0; Te < $e; Te++) {
              let qe = s.getValue(le + Te * u, "*"), Ne = s.getValue(le + (Te + 1) * u, "*"), Se = Te === $e - 1 ? void 0 : Ne - qe;
              he.push(s.UTF8ToString(qe, Se));
            }
            X.push([ae, Ee, he, "cpu"]);
          } else if (Pe === "gpu-buffer" && $e > 0) {
            let he = s.jsepGetBuffer;
            if (!he) throw new Error('preferredLocation "gpu-buffer" is not supported without using WebGPU.');
            let Te = he(le), qe = xt(M3, $e);
            if (qe === void 0 || !Nr(ae)) throw new Error(`Unsupported data type: ${ae}`);
            te = true, X.push([ae, Ee, { gpuBuffer: Te, download: s.jsepCreateDownloader(Te, qe, ae), dispose: () => {
              s._OrtReleaseTensor(Q) !== 0 && me("Can't release tensor.");
            } }, "gpu-buffer"]);
          } else if (Pe === "ml-tensor" && $e > 0) {
            let he = s.webnnEnsureTensor, Te = s.webnnIsGraphInputOutputTypeSupported;
            if (!he || !Te) throw new Error('preferredLocation "ml-tensor" is not supported without using WebNN.');
            if (xt(M3, $e) === void 0 || !Vr(ae)) throw new Error(`Unsupported data type: ${ae}`);
            if (!Te(t, ae, false)) throw new Error(`preferredLocation "ml-tensor" for ${ae} output is not supported by current WebNN Context.`);
            let Ne = await he(t, le, M3, Ee, false);
            te = true, X.push([ae, Ee, { mlTensor: Ne, download: s.webnnCreateMLTensorDownloader(le, ae), dispose: () => {
              s.webnnReleaseTensorId(le), s._OrtReleaseTensor(Q);
            } }, "ml-tensor"]);
          } else if (Pe === "ml-tensor-cpu-output" && $e > 0) {
            let he = s.webnnCreateMLTensorDownloader(le, ae)(), Te = X.length;
            te = true, B.push((async () => {
              let qe = [Te, await he];
              return s.webnnReleaseTensorId(le), s._OrtReleaseTensor(Q), qe;
            })()), X.push([ae, Ee, [], "cpu"]);
          } else {
            let he = Wt(ae), Te = new he($e);
            new Uint8Array(Te.buffer, Te.byteOffset, Te.byteLength).set(s.HEAPU8.subarray(le, le + Te.byteLength)), X.push([ae, Ee, Te, "cpu"]);
          }
        } finally {
          s.stackRestore(Y), ae === "string" && le && s._free(le), te || s._OrtReleaseTensor(Q);
        }
      }
      g && !y && (s._OrtClearBoundOutputs(g.handle) !== 0 && me("Can't clear bound outputs."), Mt.set(t, [c2, p4, m, g, y, false]));
      for (let [L, Q] of await Promise.all(B)) X[L][2] = Q;
      return wt("wasm ProcessOutputTensor"), X;
    } finally {
      s.webnnOnRunEnd?.(c2), s.stackRestore(z), S.forEach((q) => s._OrtReleaseTensor(q)), I.forEach((q) => s._OrtReleaseTensor(q)), E.forEach((q) => s._free(q)), x !== 0 && s._OrtReleaseRunOptions(x), $.forEach((q) => s._free(q));
    }
  }, Dr = (t) => {
    let e4 = ye(), r = Mt.get(t);
    if (!r) throw new Error("invalid session id");
    let n = r[0], o = e4._OrtEndProfiling(n);
    o === 0 && me("Can't get an profile file name."), e4._OrtFree(o);
  }, Mr = (t) => {
    let e4 = [];
    for (let r of t) {
      let n = r[2];
      !Array.isArray(n) && "buffer" in n && e4.push(n.buffer);
    }
    return e4;
  };
});
var Rt;
var Fe;
var dr;
var hn;
var gn;
var fn5;
var Ro;
var Uo;
var qt;
var Kt;
var qb;
var Fc;
var qc;
var Kc;
var jc;
var Zc;
var Qc;
var Yc;
var No = V(() => {
  "use strict";
  Le();
  Qn();
  vt();
  Ar();
  Rt = () => !!_e.wasm.proxy && typeof document < "u", dr = false, hn = false, gn = false, Uo = /* @__PURE__ */ new Map(), qt = (t, e4) => {
    let r = Uo.get(t);
    r ? r.push(e4) : Uo.set(t, [e4]);
  }, Kt = () => {
    if (dr || !hn || gn || !Fe) throw new Error("worker not ready");
  }, qb = (t) => {
    switch (t.data.type) {
      case "init-wasm":
        dr = false, t.data.err ? (gn = true, Ro[1](t.data.err)) : (hn = true, Ro[0]()), fn5 && (URL.revokeObjectURL(fn5), fn5 = void 0);
        break;
      case "init-ep":
      case "copy-from":
      case "create":
      case "release":
      case "run":
      case "end-profiling": {
        let e4 = Uo.get(t.data.type);
        t.data.err ? e4.shift()[1](t.data.err) : e4.shift()[0](t.data.out);
        break;
      }
      default:
    }
  }, Fc = async () => {
    if (!hn) {
      if (dr) throw new Error("multiple calls to 'initWasm()' detected.");
      if (gn) throw new Error("previous call to 'initWasm()' failed.");
      if (dr = true, Rt()) return new Promise((t, e4) => {
        Fe?.terminate(), _s().then(([r, n]) => {
          try {
            Fe = n, Fe.onerror = (i) => e4(i), Fe.onmessage = qb, Ro = [t, e4];
            let o = { type: "init-wasm", in: _e };
            !o.in.wasm.wasmPaths && (r || Xn) && (o.in.wasm.wasmPaths = { wasm: new URL("ort-wasm-simd-threaded.jsep.wasm", import.meta.url).href }), Fe.postMessage(o), fn5 = r;
          } catch (o) {
            e4(o);
          }
        }, e4);
      });
      try {
        await Er(_e.wasm), await kr(_e), hn = true;
      } catch (t) {
        throw gn = true, t;
      } finally {
        dr = false;
      }
    }
  }, qc = async (t) => {
    if (Rt()) return Kt(), new Promise((e4, r) => {
      qt("init-ep", [e4, r]);
      let n = { type: "init-ep", in: { epName: t, env: _e } };
      Fe.postMessage(n);
    });
    await Pr(_e, t);
  }, Kc = async (t) => Rt() ? (Kt(), new Promise((e4, r) => {
    qt("copy-from", [e4, r]);
    let n = { type: "copy-from", in: { buffer: t } };
    Fe.postMessage(n, [t.buffer]);
  })) : er(t), jc = async (t, e4) => {
    if (Rt()) {
      if (e4?.preferredOutputLocation) throw new Error('session option "preferredOutputLocation" is not supported for proxy.');
      return Kt(), new Promise((r, n) => {
        qt("create", [r, n]);
        let o = { type: "create", in: { model: t, options: { ...e4 } } }, i = [];
        t instanceof Uint8Array && i.push(t.buffer), Fe.postMessage(o, i);
      });
    } else return Or(t, e4);
  }, Zc = async (t) => {
    if (Rt()) return Kt(), new Promise((e4, r) => {
      qt("release", [e4, r]);
      let n = { type: "release", in: t };
      Fe.postMessage(n);
    });
    zr(t);
  }, Qc = async (t, e4, r, n, o, i) => {
    if (Rt()) {
      if (r.some((s) => s[3] !== "cpu")) throw new Error("input tensor on GPU is not supported for proxy.");
      if (o.some((s) => s)) throw new Error("pre-allocated output tensor is not supported for proxy.");
      return Kt(), new Promise((s, u) => {
        qt("run", [s, u]);
        let d = r, c2 = { type: "run", in: { sessionId: t, inputIndices: e4, inputs: d, outputIndices: n, options: i } };
        Fe.postMessage(c2, Mr(d));
      });
    } else return Br(t, e4, r, n, o, i);
  }, Yc = async (t) => {
    if (Rt()) return Kt(), new Promise((e4, r) => {
      qt("end-profiling", [e4, r]);
      let n = { type: "end-profiling", in: t };
      Fe.postMessage(n);
    });
    Dr(t);
  };
});
var Xc;
var Kb;
var bn;
var Jc = V(() => {
  "use strict";
  Le();
  No();
  J();
  Cr();
  ro();
  Xc = (t, e4) => {
    switch (t.location) {
      case "cpu":
        return [t.type, t.dims, t.data, "cpu"];
      case "gpu-buffer":
        return [t.type, t.dims, { gpuBuffer: t.gpuBuffer }, "gpu-buffer"];
      case "ml-tensor":
        return [t.type, t.dims, { mlTensor: t.mlTensor }, "ml-tensor"];
      default:
        throw new Error(`invalid data location: ${t.location} for ${e4()}`);
    }
  }, Kb = (t) => {
    switch (t[3]) {
      case "cpu":
        return new je(t[0], t[2], t[1]);
      case "gpu-buffer": {
        let e4 = t[0];
        if (!Nr(e4)) throw new Error(`not supported data type: ${e4} for deserializing GPU tensor`);
        let { gpuBuffer: r, download: n, dispose: o } = t[2];
        return je.fromGpuBuffer(r, { dataType: e4, dims: t[1], download: n, dispose: o });
      }
      case "ml-tensor": {
        let e4 = t[0];
        if (!Vr(e4)) throw new Error(`not supported data type: ${e4} for deserializing MLTensor tensor`);
        let { mlTensor: r, download: n, dispose: o } = t[2];
        return je.fromMLTensor(r, { dataType: e4, dims: t[1], download: n, dispose: o });
      }
      default:
        throw new Error(`invalid data location: ${t[3]}`);
    }
  }, bn = class {
    async fetchModelAndCopyToWasmMemory(e4) {
      return Kc(await nr(e4));
    }
    async loadModel(e4, r) {
      Ve();
      let n;
      typeof e4 == "string" ? n = await this.fetchModelAndCopyToWasmMemory(e4) : n = e4, [this.sessionId, this.inputNames, this.outputNames, this.inputMetadata, this.outputMetadata] = await jc(n, r), Re();
    }
    async dispose() {
      return Zc(this.sessionId);
    }
    async run(e4, r, n) {
      Ve();
      let o = [], i = [];
      Object.entries(e4).forEach((g) => {
        let y = g[0], b = g[1], _ = this.inputNames.indexOf(y);
        if (_ === -1) throw new Error(`invalid input '${y}'`);
        o.push(b), i.push(_);
      });
      let s = [], u = [];
      Object.entries(r).forEach((g) => {
        let y = g[0], b = g[1], _ = this.outputNames.indexOf(y);
        if (_ === -1) throw new Error(`invalid output '${y}'`);
        s.push(b), u.push(_);
      });
      let d = o.map((g, y) => Xc(g, () => `input "${this.inputNames[i[y]]}"`)), c2 = s.map((g, y) => g ? Xc(g, () => `output "${this.outputNames[u[y]]}"`) : null), p4 = await Qc(this.sessionId, i, d, u, c2, n), m = {};
      for (let g = 0; g < p4.length; g++) m[this.outputNames[u[g]]] = s[g] ?? Kb(p4[g]);
      return Re(), m;
    }
    startProfiling() {
    }
    endProfiling() {
      Yc(this.sessionId);
    }
  };
});
var tp = {};
Vt(tp, { OnnxruntimeWebAssemblyBackend: () => yn, initializeFlags: () => ep, wasmBackend: () => jb });
var ep;
var yn;
var jb;
var rp = V(() => {
  "use strict";
  Le();
  No();
  Jc();
  ep = () => {
    (typeof _e.wasm.initTimeout != "number" || _e.wasm.initTimeout < 0) && (_e.wasm.initTimeout = 0);
    let t = _e.wasm.simd;
    if (typeof t != "boolean" && t !== void 0 && t !== "fixed" && t !== "relaxed" && (console.warn(`Property "env.wasm.simd" is set to unknown value "${t}". Reset it to \`false\` and ignore SIMD feature checking.`), _e.wasm.simd = false), typeof _e.wasm.proxy != "boolean" && (_e.wasm.proxy = false), typeof _e.wasm.trace != "boolean" && (_e.wasm.trace = false), typeof _e.wasm.numThreads != "number" || !Number.isInteger(_e.wasm.numThreads) || _e.wasm.numThreads <= 0) if (typeof self < "u" && !self.crossOriginIsolated) _e.wasm.numThreads = 1;
    else {
      let e4 = typeof navigator > "u" ? Gn("node:os").cpus().length : navigator.hardwareConcurrency;
      _e.wasm.numThreads = Math.min(4, Math.ceil((e4 || 1) / 2));
    }
  }, yn = class {
    async init(e4) {
      ep(), await Fc(), await qc(e4);
    }
    async createInferenceSessionHandler(e4, r) {
      let n = new bn();
      return await n.loadModel(e4, r), n;
    }
  }, jb = new yn();
});
Le();
Le();
Le();
var as = "1.27.0";
{
  let t = (rp(), Xt(tp)).wasmBackend;
  kt("webgpu", t, 5), kt("webnn", t, 5), kt("cpu", t, 10), kt("wasm", t, 10);
}
Object.defineProperty(_e.versions, "web", { value: as, enumerable: true });

// view/onnx-runtime.ts
async function createModelRunner(modelUrl, opts = {}) {
  const session = await _f.create(modelUrl, {
    executionProviders: opts.executionProviders ?? ["wasm"],
    graphOptimizationLevel: "all"
  });
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) throw new Error("model has no input/output tensor");
  return async (input, imgsz) => {
    const tensor = new je("float32", input, [1, 3, imgsz, imgsz]);
    const result = await session.run({ [inputName]: tensor });
    const out = result[outputName];
    if (!out) throw new Error(`model produced no '${outputName}' output`);
    const anchors = out.dims[out.dims.length - 1] ?? 0;
    return { data: out.data, anchors };
  };
}

// view/ai-scan-panel.ts
var GUIDE = {
  U: { color: "WHITE", name: "Up", swatch: "#f6f7f8" },
  R: { color: "RED", name: "Right", swatch: "#d0202a" },
  F: { color: "GREEN", name: "Front", swatch: "#049e4a" },
  D: { color: "YELLOW", name: "Down", swatch: "#ffd400" },
  L: { color: "ORANGE", name: "Left", swatch: "#ff6a00" },
  B: { color: "BLUE", name: "Back", swatch: "#0057c8" }
};
var CLASS_SWATCH = ["#f6f7f8", "#d0202a", "#049e4a", "#ffd400", "#ff6a00", "#0057c8"];
var HINT = {
  NO_FACE: "point a side at the camera",
  PARTIAL_FACE: "show the whole face, centred",
  BAD_GEOMETRY: "hold it flatter and steadier"
};
var TICK_MS = 200;
var STABLE = 3;
var TEMPLATE = `
<style>
  :host { display: block; font: 14px/1.5 -apple-system, system-ui, sans-serif; color: #e6edf3; }
  .stage { position: relative; aspect-ratio: 1; background: #000; border-radius: 12px; overflow: hidden; }
  video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .status { margin: 12px 0 4px; min-height: 22px; } .status b { color: #fff; }
  .swatch { width: 15px; height: 15px; border-radius: 4px; border: 1px solid rgba(0,0,0,.4);
    display: inline-block; vertical-align: -3px; }
  .dots { display: flex; gap: 6px; margin: 8px 0; }
  .dots span { width: 22px; height: 10px; border-radius: 3px; background: #30363d; }
  .dots span.done { background: #3fb950; }
  .preview { display: none; grid-template-columns: repeat(3, 36px); gap: 4px; margin: 10px 0; }
  .preview[data-show='1'] { display: grid; }
  .preview i { width: 36px; height: 36px; border-radius: 6px; border: 1px solid rgba(0,0,0,.4); }
  .row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
  button { font: inherit; border: 0; border-radius: 7px; padding: 8px 16px; font-weight: 600; cursor: pointer; }
  button.primary { background: #58a6ff; color: #06122b; }
  button.ghost { background: #21262d; color: #e6edf3; border: 1px solid #30363d; }
  button[hidden] { display: none; }
  .err { color: #f85149; } .ok { color: #3fb950; } .muted { color: #8b949e; }
</style>
<div class="stage"><video id="video" playsinline muted></video></div>
<div class="dots" id="dots"></div>
<div class="status" id="status">Click <b>Start camera</b>, then show each side to the camera.</div>
<div class="preview" id="preview"></div>
<div class="row">
  <button class="primary" id="start">Start camera</button>
  <button class="primary" id="accept" hidden>Yes, next side</button>
  <button class="ghost" id="retake" hidden>Retake</button>
</div>
`;
var AiScanPanel = class extends HTMLElement {
  root;
  /** Model URL; the app can override before the element renders. */
  modelUrl = "./vendor/cube-yolo.onnx";
  run = null;
  source = null;
  timer = null;
  startGen = 0;
  busy = false;
  faces = {};
  faceIdx = 0;
  lastColors = "";
  stableCount = 0;
  proposed = null;
  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
  }
  connectedCallback() {
    this.root.innerHTML = TEMPLATE;
    this.buildDots();
    this.buildPreview();
    this.btn("start").addEventListener("click", () => void this.start());
    this.btn("accept").addEventListener("click", () => this.accept());
    this.btn("retake").addEventListener("click", () => this.retake());
  }
  disconnectedCallback() {
    this.stop();
  }
  /** Release the camera + stop the loop. Safe repeatedly and before first render. */
  stop() {
    this.startGen++;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.source?.stop();
    this.source = null;
    const start = this.root.getElementById("start");
    if (start) start.disabled = false;
  }
  el(id) {
    const node = this.root.getElementById(id);
    if (!node) throw new Error(`ai-scan-panel: missing #${id}`);
    return node;
  }
  btn(id) {
    return this.el(id);
  }
  async start() {
    this.btn("start").disabled = true;
    const gen = ++this.startGen;
    try {
      if (!this.run) {
        this.setStatus("Loading the model\u2026");
        this.run = await createModelRunner(this.modelUrl);
        if (gen !== this.startGen) return;
      }
      this.source = await openCamera(this.el("video"));
      if (gen !== this.startGen) return;
      this.reset();
      this.btn("start").hidden = true;
      this.loop();
    } catch (err) {
      if (gen !== this.startGen) return;
      this.btn("start").disabled = false;
      this.setStatus(this.tinted("err", `Cannot start: ${String(err?.message ?? err)}`));
    }
  }
  reset() {
    this.faceIdx = 0;
    this.lastColors = "";
    this.stableCount = 0;
    this.proposed = null;
    for (const f3 of FACES) delete this.faces[f3];
    this.buildDots();
  }
  loop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.showPreview(null);
    this.btn("accept").hidden = true;
    this.btn("retake").hidden = true;
    this.proposed = null;
    this.stableCount = 0;
    this.lastColors = "";
    this.timer = setInterval(() => void this.onTick(), TICK_MS);
  }
  stopLoop() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  async onTick() {
    if (this.busy || !this.source || !this.run) return;
    this.busy = true;
    try {
      const frame = this.source.grab();
      const fit = await detectFace(frame, this.run);
      if (this.timer === null) return;
      const face = FACES[this.faceIdx];
      const g = GUIDE[face];
      if (!fit.ok) {
        this.stableCount = 0;
        this.setStatus(
          "Show the ",
          this.swatch(g.swatch),
          " ",
          this.bold(g.color),
          ` (${g.name}) side \u2014 ${HINT[fit.reason]}\u2026`
        );
        return;
      }
      const key = fit.face.colors.join(",");
      this.stableCount = key === this.lastColors ? this.stableCount + 1 : 1;
      this.lastColors = key;
      if (this.stableCount >= STABLE) {
        this.stopLoop();
        this.propose(fit.face);
      } else {
        this.setStatus("Reading the ", this.bold(g.name), " side \u2014 hold still\u2026");
      }
    } catch {
    } finally {
      this.busy = false;
    }
  }
  propose(face) {
    this.proposed = face;
    this.showPreview(face.colors);
    const g = GUIDE[FACES[this.faceIdx]];
    this.setStatus("Read the ", this.bold(g.name), " side. Looks right?");
    this.btn("accept").hidden = false;
    this.btn("retake").hidden = false;
  }
  accept() {
    if (!this.proposed) return;
    this.faces[FACES[this.faceIdx]] = this.proposed;
    this.faceIdx++;
    this.buildDots();
    if (this.faceIdx >= FACES.length) {
      const rgbFaces = {};
      for (const f3 of FACES) rgbFaces[f3] = this.faces[f3].rgb;
      this.finish(assemble(rgbFaces));
    } else this.loop();
  }
  retake() {
    this.loop();
  }
  finish(result) {
    this.stopLoop();
    this.showPreview(null);
    this.btn("accept").hidden = true;
    this.btn("retake").hidden = true;
    if (result.valid && result.lowConfidence.length === 0) {
      this.setStatus(this.tinted("ok", "Scan complete \u2014 solvable cube captured."));
      this.dispatchEvent(new CustomEvent("scan-complete", { detail: result }));
      this.stop();
    } else {
      const why = result.valid ? "Some stickers were ambiguous" : "That isn't a solvable cube";
      this.setStatus(this.tinted("err", `${why} \u2014 press Start camera to re-scan.`));
      this.dispatchEvent(new CustomEvent("scan-invalid", { detail: result }));
      this.reset();
      this.btn("start").hidden = false;
      this.btn("start").disabled = false;
    }
  }
  buildDots() {
    const dots = this.el("dots");
    dots.textContent = "";
    FACES.forEach((face, i) => {
      const span = document.createElement("span");
      span.className = i < this.faceIdx ? "done" : "";
      span.title = GUIDE[face].name;
      dots.appendChild(span);
    });
  }
  buildPreview() {
    const p4 = this.el("preview");
    p4.textContent = "";
    for (let i = 0; i < 9; i++) p4.appendChild(document.createElement("i"));
  }
  showPreview(colors) {
    const p4 = this.el("preview");
    if (!colors) {
      p4.dataset.show = "0";
      return;
    }
    const cells = p4.querySelectorAll("i");
    for (let i = 0; i < 9; i++) {
      cells[i].style.background = CLASS_SWATCH[colors[i]] ?? "#000";
    }
    p4.dataset.show = "1";
  }
  setStatus(...parts) {
    const status = this.el("status");
    status.textContent = "";
    status.append(...parts);
  }
  bold(text) {
    const b = document.createElement("b");
    b.textContent = text;
    return b;
  }
  swatch(color) {
    const s = document.createElement("span");
    s.className = "swatch";
    s.style.background = color;
    return s;
  }
  tinted(cls, text) {
    const span = document.createElement("span");
    span.className = cls;
    span.textContent = text;
    return span;
  }
};
if (!customElements.get("ai-scan-panel")) {
  customElements.define("ai-scan-panel", AiScanPanel);
}
export {
  AiScanPanel
};
/*! Bundled license information:

onnxruntime-web/dist/ort.bundle.min.mjs:
  (*!
   * ONNX Runtime Web v1.27.0
   * Copyright (c) Microsoft Corporation. All rights reserved.
   * Licensed under the MIT License.
   *)

onnxruntime-web/dist/ort.bundle.min.mjs:
  (**
   * @license
   * Copyright 2021 Google LLC. All Rights Reserved.
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   * http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   * =============================================================================
   *)
  (**
   * @license
   * Copyright 2020 Google LLC. All Rights Reserved.
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   * http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   * =============================================================================
   *)
  (**
   * @license
   * Copyright 2019 Google LLC. All Rights Reserved.
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   * http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   * =============================================================================
   *)
*/
