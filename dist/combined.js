// ============================================================
// ggit combined bundle - deploy.ps1 により自動生成（直接編集しないこと）
// 元ファイル: src/ 配下の .js を統合
// ============================================================

// ----- File: src/vendor/DiffMatchPatch.js -----
/**
 * Diff Match and Patch
 * Copyright 2018 The diff-match-patch Authors.
 * https://github.com/google/diff-match-patch
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Computes the difference between two texts to create a patch.
 * Applies the patch onto another text, allowing for errors.
 * @author fraser@google.com (Neil Fraser)
 */

/**
 * Class containing the diff, match and patch methods.
 * @constructor
 */
var diff_match_patch = function() {

  // Defaults.
  // Redefine these in your program to override the defaults.

  // Number of seconds to map a diff before giving up (0 for infinity).
  this.Diff_Timeout = 1.0;
  // Cost of an empty edit operation in terms of edit characters.
  this.Diff_EditCost = 4;
  // At what point is no match declared (0.0 = perfection, 1.0 = very loose).
  this.Match_Threshold = 0.5;
  // How far to search for a match (0 = exact location, 1000+ = broad match).
  // A match this many characters away from the expected location will add
  // 1.0 to the score (0.0 is a perfect match).
  this.Match_Distance = 1000;
  // When deleting a large block of text (over ~64 characters), how close do
  // the contents have to be to match the expected contents. (0.0 = perfection,
  // 1.0 = very loose).  Note that Match_Threshold controls how closely the
  // end points of a delete need to match.
  this.Patch_DeleteThreshold = 0.5;
  // Chunk size for context length.
  this.Patch_Margin = 4;

  // The number of bits in an int.
  this.Match_MaxBits = 32;
};


//  DIFF FUNCTIONS


/**
 * The data structure representing a diff is an array of tuples:
 * [[DIFF_DELETE, 'Hello'], [DIFF_INSERT, 'Goodbye'], [DIFF_EQUAL, ' world.']]
 * which means: delete 'Hello', add 'Goodbye' and keep ' world.'
 */
var DIFF_DELETE = -1;
var DIFF_INSERT = 1;
var DIFF_EQUAL = 0;

/**
 * Class representing one diff tuple.
 * Attempts to look like a two-element array (which is what this used to be).
 * @param {number} op Operation, one of: DIFF_DELETE, DIFF_INSERT, DIFF_EQUAL.
 * @param {string} text Text to be deleted, inserted, or retained.
 * @constructor
 */
diff_match_patch.Diff = function(op, text) {
  this[0] = op;
  this[1] = text;
};

diff_match_patch.Diff.prototype.length = 2;

/**
 * Emulate the output of a two-element array.
 * @return {string} Diff operation as a string.
 */
diff_match_patch.Diff.prototype.toString = function() {
  return this[0] + ',' + this[1];
};


/**
 * Find the differences between two texts.  Simplifies the problem by stripping
 * any common prefix or suffix off the texts before diffing.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @param {boolean=} opt_checklines Optional speedup flag. If present and false,
 *     then don't run a line-level diff first to identify the changed areas.
 *     Defaults to true, which does a faster, slightly less optimal diff.
 * @param {number=} opt_deadline Optional time when the diff should be complete
 *     by.  Used internally for recursive calls.  Users should set DiffTimeout
 *     instead.
 * @return {!Array.<!diff_match_patch.Diff>} Array of diff tuples.
 */
diff_match_patch.prototype.diff_main = function(text1, text2, opt_checklines,
    opt_deadline) {
  // Set a deadline by which time the diff must be complete.
  if (typeof opt_deadline == 'undefined') {
    if (this.Diff_Timeout <= 0) {
      opt_deadline = Number.MAX_VALUE;
    } else {
      opt_deadline = (new Date).getTime() + this.Diff_Timeout * 1000;
    }
  }
  var deadline = opt_deadline;

  // Check for null inputs.
  if (text1 == null || text2 == null) {
    throw new Error('Null input. (diff_main)');
  }

  // Check for equality (speedup).
  if (text1 == text2) {
    if (text1) {
      return [new diff_match_patch.Diff(DIFF_EQUAL, text1)];
    }
    return [];
  }

  if (typeof opt_checklines == 'undefined') {
    opt_checklines = true;
  }
  var checklines = opt_checklines;

  // Trim off common prefix (speedup).
  var commonlength = this.diff_commonPrefix(text1, text2);
  var commonprefix = text1.substring(0, commonlength);
  text1 = text1.substring(commonlength);
  text2 = text2.substring(commonlength);

  // Trim off common suffix (speedup).
  commonlength = this.diff_commonSuffix(text1, text2);
  var commonsuffix = text1.substring(text1.length - commonlength);
  text1 = text1.substring(0, text1.length - commonlength);
  text2 = text2.substring(0, text2.length - commonlength);

  // Compute the diff on the middle block.
  var diffs = this.diff_compute_(text1, text2, checklines, deadline);

  // Restore the prefix and suffix.
  if (commonprefix) {
    diffs.unshift(new diff_match_patch.Diff(DIFF_EQUAL, commonprefix));
  }
  if (commonsuffix) {
    diffs.push(new diff_match_patch.Diff(DIFF_EQUAL, commonsuffix));
  }
  this.diff_cleanupMerge(diffs);
  return diffs;
};


/**
 * Find the differences between two texts.  Assumes that the texts do not
 * have any common prefix or suffix.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @param {boolean} checklines Speedup flag.  If false, then don't run a
 *     line-level diff first to identify the changed areas.
 *     If true, then run a faster, slightly less optimal diff.
 * @param {number} deadline Time when the diff should be complete by.
 * @return {!Array.<!diff_match_patch.Diff>} Array of diff tuples.
 * @private
 */
diff_match_patch.prototype.diff_compute_ = function(text1, text2, checklines,
    deadline) {
  var diffs;

  if (!text1) {
    // Just add some text (speedup).
    return [new diff_match_patch.Diff(DIFF_INSERT, text2)];
  }

  if (!text2) {
    // Just delete some text (speedup).
    return [new diff_match_patch.Diff(DIFF_DELETE, text1)];
  }

  var longtext = text1.length > text2.length ? text1 : text2;
  var shorttext = text1.length > text2.length ? text2 : text1;
  var i = longtext.indexOf(shorttext);
  if (i != -1) {
    // Shorter text is inside the longer text (speedup).
    diffs = [new diff_match_patch.Diff(DIFF_INSERT, longtext.substring(0, i)),
             new diff_match_patch.Diff(DIFF_EQUAL, shorttext),
             new diff_match_patch.Diff(DIFF_INSERT,
                 longtext.substring(i + shorttext.length))];
    // Swap insertions for deletions if diff is reversed.
    if (text1.length > text2.length) {
      diffs[0][0] = diffs[2][0] = DIFF_DELETE;
    }
    return diffs;
  }

  if (shorttext.length == 1) {
    // Single character string.
    // After the previous speedup, the character can't be an equality.
    return [new diff_match_patch.Diff(DIFF_DELETE, text1),
            new diff_match_patch.Diff(DIFF_INSERT, text2)];
  }

  // Check to see if the problem can be split in two.
  var hm = this.diff_halfMatch_(text1, text2);
  if (hm) {
    // A half-match was found, sort out the return data.
    var text1_a = hm[0];
    var text1_b = hm[1];
    var text2_a = hm[2];
    var text2_b = hm[3];
    var mid_common = hm[4];
    // Send both pairs off for separate processing.
    var diffs_a = this.diff_main(text1_a, text2_a, checklines, deadline);
    var diffs_b = this.diff_main(text1_b, text2_b, checklines, deadline);
    // Merge the results.
    return diffs_a.concat([new diff_match_patch.Diff(DIFF_EQUAL, mid_common)],
                          diffs_b);
  }

  if (checklines && text1.length > 100 && text2.length > 100) {
    return this.diff_lineMode_(text1, text2, deadline);
  }

  return this.diff_bisect_(text1, text2, deadline);
};


/**
 * Do a quick line-level diff on both strings, then rediff the parts for
 * greater accuracy.
 * This speedup can produce non-minimal diffs.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @param {number} deadline Time when the diff should be complete by.
 * @return {!Array.<!diff_match_patch.Diff>} Array of diff tuples.
 * @private
 */
diff_match_patch.prototype.diff_lineMode_ = function(text1, text2, deadline) {
  // Scan the text on a line-by-line basis first.
  var a = this.diff_linesToChars_(text1, text2);
  text1 = a.chars1;
  text2 = a.chars2;
  var linearray = a.lineArray;

  var diffs = this.diff_main(text1, text2, false, deadline);

  // Convert the diff back to original text.
  this.diff_charsToLines_(diffs, linearray);
  // Eliminate freak matches (e.g. blank lines)
  this.diff_cleanupSemantic(diffs);

  // Rediff any replacement blocks, this time character-by-character.
  // Add a dummy entry at the end.
  diffs.push(new diff_match_patch.Diff(DIFF_EQUAL, ''));
  var pointer = 0;
  var count_delete = 0;
  var count_insert = 0;
  var text_delete = '';
  var text_insert = '';
  while (pointer < diffs.length) {
    switch (diffs[pointer][0]) {
      case DIFF_INSERT:
        count_insert++;
        text_insert += diffs[pointer][1];
        break;
      case DIFF_DELETE:
        count_delete++;
        text_delete += diffs[pointer][1];
        break;
      case DIFF_EQUAL:
        // Upon reaching an equality, check for prior redundancies.
        if (count_delete >= 1 && count_insert >= 1) {
          // Delete the offending records and add the merged ones.
          diffs.splice(pointer - count_delete - count_insert,
                       count_delete + count_insert);
          pointer = pointer - count_delete - count_insert;
          var subDiff =
              this.diff_main(text_delete, text_insert, false, deadline);
          for (var j = subDiff.length - 1; j >= 0; j--) {
            diffs.splice(pointer, 0, subDiff[j]);
          }
          pointer = pointer + subDiff.length;
        }
        count_insert = 0;
        count_delete = 0;
        text_delete = '';
        text_insert = '';
        break;
    }
    pointer++;
  }
  diffs.pop();  // Remove the dummy entry at the end.

  return diffs;
};


/**
 * Find the 'middle snake' of a diff, split the problem in two
 * and return the recursively constructed diff.
 * See Myers 1986 paper: An O(ND) Difference Algorithm and Its Variations.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @param {number} deadline Time at which to bail if not yet complete.
 * @return {!Array.<!diff_match_patch.Diff>} Array of diff tuples.
 * @private
 */
diff_match_patch.prototype.diff_bisect_ = function(text1, text2, deadline) {
  // Cache the text lengths to prevent multiple calls.
  var text1_length = text1.length;
  var text2_length = text2.length;
  var max_d = Math.ceil((text1_length + text2_length) / 2);
  var v_offset = max_d;
  var v_length = 2 * max_d;
  var v1 = new Array(v_length);
  var v2 = new Array(v_length);
  // Setting all elements to -1 is faster in Chrome & Firefox than mixing
  // integers and undefined.
  for (var x = 0; x < v_length; x++) {
    v1[x] = -1;
    v2[x] = -1;
  }
  v1[v_offset + 1] = 0;
  v2[v_offset + 1] = 0;
  var delta = text1_length - text2_length;
  // If the total number of characters is odd, then the front path will collide
  // with the reverse path.
  var front = (delta % 2 != 0);
  // Offsets for start and end of k loop.
  // Prevents mapping of space beyond the grid.
  var k1start = 0;
  var k1end = 0;
  var k2start = 0;
  var k2end = 0;
  for (var d = 0; d < max_d; d++) {
    // Bail out if deadline is reached.
    if ((new Date()).getTime() > deadline) {
      break;
    }

    // Walk the front path one step.
    for (var k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      var k1_offset = v_offset + k1;
      var x1;
      if (k1 == -d || (k1 != d && v1[k1_offset - 1] < v1[k1_offset + 1])) {
        x1 = v1[k1_offset + 1];
      } else {
        x1 = v1[k1_offset - 1] + 1;
      }
      var y1 = x1 - k1;
      while (x1 < text1_length && y1 < text2_length &&
             text1.charAt(x1) == text2.charAt(y1)) {
        x1++;
        y1++;
      }
      v1[k1_offset] = x1;
      if (x1 > text1_length) {
        // Ran off the right of the graph.
        k1end += 2;
      } else if (y1 > text2_length) {
        // Ran off the bottom of the graph.
        k1start += 2;
      } else if (front) {
        var k2_offset = v_offset + delta - k1;
        if (k2_offset >= 0 && k2_offset < v_length && v2[k2_offset] != -1) {
          // Mirror x2 onto top-left coordinate system.
          var x2 = text1_length - v2[k2_offset];
          if (x1 >= x2) {
            // Overlap detected.
            return this.diff_bisectSplit_(text1, text2, x1, y1, deadline);
          }
        }
      }
    }

    // Walk the reverse path one step.
    for (var k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      var k2_offset = v_offset + k2;
      var x2;
      if (k2 == -d || (k2 != d && v2[k2_offset - 1] < v2[k2_offset + 1])) {
        x2 = v2[k2_offset + 1];
      } else {
        x2 = v2[k2_offset - 1] + 1;
      }
      var y2 = x2 - k2;
      while (x2 < text1_length && y2 < text2_length &&
             text1.charAt(text1_length - x2 - 1) ==
             text2.charAt(text2_length - y2 - 1)) {
        x2++;
        y2++;
      }
      v2[k2_offset] = x2;
      if (x2 > text1_length) {
        // Ran off the left of the graph.
        k2end += 2;
      } else if (y2 > text2_length) {
        // Ran off the top of the graph.
        k2start += 2;
      } else if (!front) {
        var k1_offset = v_offset + delta - k2;
        if (k1_offset >= 0 && k1_offset < v_length && v1[k1_offset] != -1) {
          var x1 = v1[k1_offset];
          var y1 = v_offset + x1 - k1_offset;
          // Mirror x2 onto top-left coordinate system.
          x2 = text1_length - x2;
          if (x1 >= x2) {
            // Overlap detected.
            return this.diff_bisectSplit_(text1, text2, x1, y1, deadline);
          }
        }
      }
    }
  }
  // Diff took too long and hit the deadline or
  // number of diffs equals number of characters, no commonality at all.
  return [new diff_match_patch.Diff(DIFF_DELETE, text1),
          new diff_match_patch.Diff(DIFF_INSERT, text2)];
};


/**
 * Given the location of the 'middle snake', split the diff in two parts
 * and recurse.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @param {number} x Index of split point in text1.
 * @param {number} y Index of split point in text2.
 * @param {number} deadline Time at which to bail if not yet complete.
 * @return {!Array.<!diff_match_patch.Diff>} Array of diff tuples.
 * @private
 */
diff_match_patch.prototype.diff_bisectSplit_ = function(text1, text2, x, y,
    deadline) {
  var text1a = text1.substring(0, x);
  var text2a = text2.substring(0, y);
  var text1b = text1.substring(x);
  var text2b = text2.substring(y);

  // Compute both diffs serially.
  var diffs = this.diff_main(text1a, text2a, false, deadline);
  var diffsb = this.diff_main(text1b, text2b, false, deadline);

  return diffs.concat(diffsb);
};


/**
 * Split two texts into an array of strings.  Reduce the texts to a string of
 * hashes where each Unicode character represents one line.
 * @param {string} text1 First string.
 * @param {string} text2 Second string.
 * @return {{chars1: string, chars2: string, lineArray: !Array.<string>}}
 *     An object containing the encoded text1, the encoded text2 and
 *     the array of unique strings.
 *     The zeroth element of the array of unique strings is intentionally blank.
 * @private
 */
diff_match_patch.prototype.diff_linesToChars_ = function(text1, text2) {
  var lineArray = [];  // e.g. lineArray[4] == 'Hello\n'
  var lineHash = {};   // e.g. lineHash['Hello\n'] == 4

  // '\x00' is a valid character, but various debuggers don't like it.
  // So we'll insert a junk entry to avoid generating a null character.
  lineArray[0] = '';

  /**
   * Split a text into an array of strings.  Reduce the texts to a string of
   * hashes where each Unicode character represents one line.
   * Modifies linearray and linehash through being a closure.
   * @param {string} text String to encode.
   * @return {string} Encoded string.
   * @private
   */
  function diff_linesToCharsMunge_(text) {
    var chars = '';
    // Walk the text, pulling out a substring for each line.
    // text.split('\n') would would temporarily double our memory footprint.
    // Modifying text would create many large strings to garbage collect.
    var lineStart = 0;
    var lineEnd = -1;
    // Keeping our own length variable is faster than looking it up.
    var lineArrayLength = lineArray.length;
    while (lineEnd < text.length - 1) {
      lineEnd = text.indexOf('\n', lineStart);
      if (lineEnd == -1) {
        lineEnd = text.length - 1;
      }
      var line = text.substring(lineStart, lineEnd + 1);

      if (lineHash.hasOwnProperty ? lineHash.hasOwnProperty(line) :
          (lineHash[line] !== undefined)) {
        chars += String.fromCharCode(lineHash[line]);
      } else {
        if (lineArrayLength == maxLines) {
          // Bail out at 65535 because
          // String.fromCharCode(65536) == String.fromCharCode(0)
          line = text.substring(lineStart);
          lineEnd = text.length;
        }
        chars += String.fromCharCode(lineArrayLength);
        lineHash[line] = lineArrayLength;
        lineArray[lineArrayLength++] = line;
      }
      lineStart = lineEnd + 1;
    }
    return chars;
  }
  // Allocate 2/3rds of the space for text1, the rest for text2.
  var maxLines = 40000;
  var chars1 = diff_linesToCharsMunge_(text1);
  maxLines = 65535;
  var chars2 = diff_linesToCharsMunge_(text2);
  return {chars1: chars1, chars2: chars2, lineArray: lineArray};
};


/**
 * Rehydrate the text in a diff from a string of line hashes to real lines of
 * text.
 * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
 * @param {!Array.<string>} lineArray Array of unique strings.
 * @private
 */
diff_match_patch.prototype.diff_charsToLines_ = function(diffs, lineArray) {
  for (var i = 0; i < diffs.length; i++) {
    var chars = diffs[i][1];
    var text = [];
    for (var j = 0; j < chars.length; j++) {
      text[j] = lineArray[chars.charCodeAt(j)];
    }
    diffs[i][1] = text.join('');
  }
};


/**
 * Determine the common prefix of two strings.
 * @param {string} text1 First string.
 * @param {string} text2 Second string.
 * @return {number} The number of characters common to the start of each
 *     string.
 */
diff_match_patch.prototype.diff_commonPrefix = function(text1, text2) {
  // Quick check for common null cases.
  if (!text1 || !text2 || text1.charAt(0) != text2.charAt(0)) {
    return 0;
  }
  // Binary search.
  // Performance analysis: https://neil.fraser.name/news/2007/10/09/
  var pointermin = 0;
  var pointermax = Math.min(text1.length, text2.length);
  var pointermid = pointermax;
  var pointerstart = 0;
  while (pointermin < pointermid) {
    if (text1.substring(pointerstart, pointermid) ==
        text2.substring(pointerstart, pointermid)) {
      pointermin = pointermid;
      pointerstart = pointermin;
    } else {
      pointermax = pointermid;
    }
    pointermid = Math.floor((pointermax - pointermin) / 2 + pointermin);
  }
  return pointermid;
};


/**
 * Determine the common suffix of two strings.
 * @param {string} text1 First string.
 * @param {string} text2 Second string.
 * @return {number} The number of characters common to the end of each string.
 */
diff_match_patch.prototype.diff_commonSuffix = function(text1, text2) {
  // Quick check for common null cases.
  if (!text1 || !text2 ||
      text1.charAt(text1.length - 1) != text2.charAt(text2.length - 1)) {
    return 0;
  }
  // Binary search.
  // Performance analysis: https://neil.fraser.name/news/2007/10/09/
  var pointermin = 0;
  var pointermax = Math.min(text1.length, text2.length);
  var pointermid = pointermax;
  var pointerend = 0;
  while (pointermin < pointermid) {
    if (text1.substring(text1.length - pointermid, text1.length - pointerend) ==
        text2.substring(text2.length - pointermid, text2.length - pointerend)) {
      pointermin = pointermid;
      pointerend = pointermin;
    } else {
      pointermax = pointermid;
    }
    pointermid = Math.floor((pointermax - pointermin) / 2 + pointermin);
  }
  return pointermid;
};


/**
 * Determine if the suffix of one string is the prefix of another.
 * @param {string} text1 First string.
 * @param {string} text2 Second string.
 * @return {number} The number of characters common to the end of the first
 *     string and the start of the second string.
 * @private
 */
diff_match_patch.prototype.diff_commonOverlap_ = function(text1, text2) {
  // Cache the text lengths to prevent multiple calls.
  var text1_length = text1.length;
  var text2_length = text2.length;
  // Eliminate the null case.
  if (text1_length == 0 || text2_length == 0) {
    return 0;
  }
  // Truncate the longer string.
  if (text1_length > text2_length) {
    text1 = text1.substring(text1_length - text2_length);
  } else if (text1_length < text2_length) {
    text2 = text2.substring(0, text1_length);
  }
  var text_length = Math.min(text1_length, text2_length);
  // Quick check for the worst case.
  if (text1 == text2) {
    return text_length;
  }

  // Start by looking for a single character match
  // and increase length until no match is found.
  // Performance analysis: https://neil.fraser.name/news/2010/11/04/
  var best = 0;
  var length = 1;
  while (true) {
    var pattern = text1.substring(text_length - length);
    var found = text2.indexOf(pattern);
    if (found == -1) {
      return best;
    }
    length += found;
    if (found == 0 || text1.substring(text_length - length) ==
        text2.substring(0, length)) {
      best = length;
      length++;
    }
  }
};


/**
 * Do the two texts share a substring which is at least half the length of the
 * longer text?
 * This speedup can produce non-minimal diffs.
 * @param {string} text1 First string.
 * @param {string} text2 Second string.
 * @return {Array.<string>} Five element Array, containing the prefix of
 *     text1, the suffix of text1, the prefix of text2, the suffix of
 *     text2 and the common middle.  Or null if there was no match.
 * @private
 */
diff_match_patch.prototype.diff_halfMatch_ = function(text1, text2) {
  if (this.Diff_Timeout <= 0) {
    // Don't risk returning a non-optimal diff if we have unlimited time.
    return null;
  }
  var longtext = text1.length > text2.length ? text1 : text2;
  var shorttext = text1.length > text2.length ? text2 : text1;
  if (longtext.length < 4 || shorttext.length * 2 < longtext.length) {
    return null;  // Pointless.
  }
  var dmp = this;  // 'this' becomes 'window' in a closure.

  /**
   * Does a substring of shorttext exist within longtext such that the substring
   * is at least half the length of longtext?
   * Closure, but does not reference any external variables.
   * @param {string} longtext Longer string.
   * @param {string} shorttext Shorter string.
   * @param {number} i Start index of quarter length substring within longtext.
   * @return {Array.<string>} Five element Array, containing the prefix of
   *     longtext, the suffix of longtext, the prefix of shorttext, the suffix
   *     of shorttext and the common middle.  Or null if there was no match.
   * @private
   */
  function diff_halfMatchI_(longtext, shorttext, i) {
    // Start with a 1/4 length substring at position i as a seed.
    var seed = longtext.substring(i, i + Math.floor(longtext.length / 4));
    var j = -1;
    var best_common = '';
    var best_longtext_a, best_longtext_b, best_shorttext_a, best_shorttext_b;
    while ((j = shorttext.indexOf(seed, j + 1)) != -1) {
      var prefixLength = dmp.diff_commonPrefix(longtext.substring(i),
                                               shorttext.substring(j));
      var suffixLength = dmp.diff_commonSuffix(longtext.substring(0, i),
                                               shorttext.substring(0, j));
      if (best_common.length < suffixLength + prefixLength) {
        best_common = shorttext.substring(j - suffixLength, j) +
            shorttext.substring(j, j + prefixLength);
        best_longtext_a = longtext.substring(0, i - suffixLength);
        best_longtext_b = longtext.substring(i + prefixLength);
        best_shorttext_a = shorttext.substring(0, j - suffixLength);
        best_shorttext_b = shorttext.substring(j + prefixLength);
      }
    }
    if (best_common.length * 2 >= longtext.length) {
      return [best_longtext_a, best_longtext_b,
              best_shorttext_a, best_shorttext_b, best_common];
    } else {
      return null;
    }
  }

  // First check if the second quarter is the seed for a half-match.
  var hm1 = diff_halfMatchI_(longtext, shorttext,
                             Math.ceil(longtext.length / 4));
  // Check again based on the third quarter.
  var hm2 = diff_halfMatchI_(longtext, shorttext,
                             Math.ceil(longtext.length / 2));
  var hm;
  if (!hm1 && !hm2) {
    return null;
  } else if (!hm2) {
    hm = hm1;
  } else if (!hm1) {
    hm = hm2;
  } else {
    // Both matched.  Select the longest.
    hm = hm1[4].length > hm2[4].length ? hm1 : hm2;
  }

  // A half-match was found, sort out the return data.
  var text1_a, text1_b, text2_a, text2_b;
  if (text1.length > text2.length) {
    text1_a = hm[0];
    text1_b = hm[1];
    text2_a = hm[2];
    text2_b = hm[3];
  } else {
    text2_a = hm[0];
    text2_b = hm[1];
    text1_a = hm[2];
    text1_b = hm[3];
  }
  var mid_common = hm[4];
  return [text1_a, text1_b, text2_a, text2_b, mid_common];
};


/**
 * Reduce the number of edits by eliminating semantically trivial equalities.
 * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
 */
diff_match_patch.prototype.diff_cleanupSemantic = function(diffs) {
  var changes = false;
  var equalities = [];  // Stack of indices where equalities are found.
  var equalitiesLength = 0;  // Keeping our own length var is faster in JS.
  /** @type {?string} */
  var lastEquality = null;
  // Always equal to diffs[equalities[equalitiesLength - 1]][1]
  var pointer = 0;  // Index of current position.
  // Number of characters that changed prior to the equality.
  var length_insertions1 = 0;
  var length_deletions1 = 0;
  // Number of characters that changed after the equality.
  var length_insertions2 = 0;
  var length_deletions2 = 0;
  while (pointer < diffs.length) {
    if (diffs[pointer][0] == DIFF_EQUAL) {  // Equality found.
      equalities[equalitiesLength++] = pointer;
      length_insertions1 = length_insertions2;
      length_deletions1 = length_deletions2;
      length_insertions2 = 0;
      length_deletions2 = 0;
      lastEquality = diffs[pointer][1];
    } else {  // An insertion or deletion.
      if (diffs[pointer][0] == DIFF_INSERT) {
        length_insertions2 += diffs[pointer][1].length;
      } else {
        length_deletions2 += diffs[pointer][1].length;
      }
      // Eliminate an equality that is smaller or equal to the edits on both
      // sides of it.
      if (lastEquality && (lastEquality.length <=
          Math.max(length_insertions1, length_deletions1)) &&
          (lastEquality.length <= Math.max(length_insertions2,
                                           length_deletions2))) {
        // Duplicate record.
        diffs.splice(equalities[equalitiesLength - 1], 0,
                     new diff_match_patch.Diff(DIFF_DELETE, lastEquality));
        // Change second copy to insert.
        diffs[equalities[equalitiesLength - 1] + 1][0] = DIFF_INSERT;
        // Throw away the equality we just deleted.
        equalitiesLength--;
        // Throw away the previous equality (it needs to be reevaluated).
        equalitiesLength--;
        pointer = equalitiesLength > 0 ? equalities[equalitiesLength - 1] : -1;
        length_insertions1 = 0;  // Reset the counters.
        length_deletions1 = 0;
        length_insertions2 = 0;
        length_deletions2 = 0;
        lastEquality = null;
        changes = true;
      }
    }
    pointer++;
  }

  // Normalize the diff.
  if (changes) {
    this.diff_cleanupMerge(diffs);
  }
  this.diff_cleanupSemanticLossless(diffs);

  // Find any overlaps between deletions and insertions.
  // e.g: <del>abcxxx</del><ins>xxxdef</ins>
  //   -> <del>abc</del>xxx<ins>def</ins>
  // e.g: <del>xxxabc</del><ins>defxxx</ins>
  //   -> <ins>def</ins>xxx<del>abc</del>
  // Only extract an overlap if it is as big as the edit ahead or behind it.
  pointer = 1;
  while (pointer < diffs.length) {
    if (diffs[pointer - 1][0] == DIFF_DELETE &&
        diffs[pointer][0] == DIFF_INSERT) {
      var deletion = diffs[pointer - 1][1];
      var insertion = diffs[pointer][1];
      var overlap_length1 = this.diff_commonOverlap_(deletion, insertion);
      var overlap_length2 = this.diff_commonOverlap_(insertion, deletion);
      if (overlap_length1 >= overlap_length2) {
        if (overlap_length1 >= deletion.length / 2 ||
            overlap_length1 >= insertion.length / 2) {
          // Overlap found.  Insert an equality and trim the surrounding edits.
          diffs.splice(pointer, 0, new diff_match_patch.Diff(DIFF_EQUAL,
              insertion.substring(0, overlap_length1)));
          diffs[pointer - 1][1] =
              deletion.substring(0, deletion.length - overlap_length1);
          diffs[pointer + 1][1] = insertion.substring(overlap_length1);
          pointer++;
        }
      } else {
        if (overlap_length2 >= deletion.length / 2 ||
            overlap_length2 >= insertion.length / 2) {
          // Reverse overlap found.
          // Insert an equality and swap and trim the surrounding edits.
          diffs.splice(pointer, 0, new diff_match_patch.Diff(DIFF_EQUAL,
              deletion.substring(0, overlap_length2)));
          diffs[pointer - 1][0] = DIFF_INSERT;
          diffs[pointer - 1][1] =
              insertion.substring(0, insertion.length - overlap_length2);
          diffs[pointer + 1][0] = DIFF_DELETE;
          diffs[pointer + 1][1] =
              deletion.substring(overlap_length2);
          pointer++;
        }
      }
      pointer++;
    }
    pointer++;
  }
};


/**
 * Look for single edits surrounded on both sides by equalities
 * which can be shifted sideways to align the edit to a word boundary.
 * e.g: The c<ins>at c</ins>ame. -> The <ins>cat </ins>came.
 * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
 */
diff_match_patch.prototype.diff_cleanupSemanticLossless = function(diffs) {
  /**
   * Given two strings, compute a score representing whether the internal
   * boundary falls on logical boundaries.
   * Scores range from 6 (best) to 0 (worst).
   * Closure, but does not reference any external variables.
   * @param {string} one First string.
   * @param {string} two Second string.
   * @return {number} The score.
   * @private
   */
  function diff_cleanupSemanticScore_(one, two) {
    if (!one || !two) {
      // Edges are the best.
      return 6;
    }

    // Each port of this function behaves slightly differently due to
    // subtle differences in each language's definition of things like
    // 'whitespace'.  Since this function's purpose is largely cosmetic,
    // the choice has been made to use each language's native features
    // rather than force total conformity.
    var char1 = one.charAt(one.length - 1);
    var char2 = two.charAt(0);
    var nonAlphaNumeric1 = char1.match(diff_match_patch.nonAlphaNumericRegex_);
    var nonAlphaNumeric2 = char2.match(diff_match_patch.nonAlphaNumericRegex_);
    var whitespace1 = nonAlphaNumeric1 &&
        char1.match(diff_match_patch.whitespaceRegex_);
    var whitespace2 = nonAlphaNumeric2 &&
        char2.match(diff_match_patch.whitespaceRegex_);
    var lineBreak1 = whitespace1 &&
        char1.match(diff_match_patch.linebreakRegex_);
    var lineBreak2 = whitespace2 &&
        char2.match(diff_match_patch.linebreakRegex_);
    var blankLine1 = lineBreak1 &&
        one.match(diff_match_patch.blanklineEndRegex_);
    var blankLine2 = lineBreak2 &&
        two.match(diff_match_patch.blanklineStartRegex_);

    if (blankLine1 || blankLine2) {
      // Five points for blank lines.
      return 5;
    } else if (lineBreak1 || lineBreak2) {
      // Four points for line breaks.
      return 4;
    } else if (nonAlphaNumeric1 && !whitespace1 && whitespace2) {
      // Three points for end of sentences.
      return 3;
    } else if (whitespace1 || whitespace2) {
      // Two points for whitespace.
      return 2;
    } else if (nonAlphaNumeric1 || nonAlphaNumeric2) {
      // One point for non-alphanumeric.
      return 1;
    }
    return 0;
  }

  var pointer = 1;
  // Intentionally ignore the first and last element (don't need checking).
  while (pointer < diffs.length - 1) {
    if (diffs[pointer - 1][0] == DIFF_EQUAL &&
        diffs[pointer + 1][0] == DIFF_EQUAL) {
      // This is a single edit surrounded by equalities.
      var equality1 = diffs[pointer - 1][1];
      var edit = diffs[pointer][1];
      var equality2 = diffs[pointer + 1][1];

      // First, shift the edit as far left as possible.
      var commonOffset = this.diff_commonSuffix(equality1, edit);
      if (commonOffset) {
        var commonString = edit.substring(edit.length - commonOffset);
        equality1 = equality1.substring(0, equality1.length - commonOffset);
        edit = commonString + edit.substring(0, edit.length - commonOffset);
        equality2 = commonString + equality2;
      }

      // Second, step character by character right, looking for the best fit.
      var bestEquality1 = equality1;
      var bestEdit = edit;
      var bestEquality2 = equality2;
      var bestScore = diff_cleanupSemanticScore_(equality1, edit) +
          diff_cleanupSemanticScore_(edit, equality2);
      while (edit.charAt(0) === equality2.charAt(0)) {
        equality1 += edit.charAt(0);
        edit = edit.substring(1) + equality2.charAt(0);
        equality2 = equality2.substring(1);
        var score = diff_cleanupSemanticScore_(equality1, edit) +
            diff_cleanupSemanticScore_(edit, equality2);
        // The >= encourages trailing rather than leading whitespace on edits.
        if (score >= bestScore) {
          bestScore = score;
          bestEquality1 = equality1;
          bestEdit = edit;
          bestEquality2 = equality2;
        }
      }

      if (diffs[pointer - 1][1] != bestEquality1) {
        // We have an improvement, save it back to the diff.
        if (bestEquality1) {
          diffs[pointer - 1][1] = bestEquality1;
        } else {
          diffs.splice(pointer - 1, 1);
          pointer--;
        }
        diffs[pointer][1] = bestEdit;
        if (bestEquality2) {
          diffs[pointer + 1][1] = bestEquality2;
        } else {
          diffs.splice(pointer + 1, 1);
          pointer--;
        }
      }
    }
    pointer++;
  }
};

// Define some regex patterns for matching boundaries.
diff_match_patch.nonAlphaNumericRegex_ = /[^a-zA-Z0-9]/;
diff_match_patch.whitespaceRegex_ = /\s/;
diff_match_patch.linebreakRegex_ = /[\r\n]/;
diff_match_patch.blanklineEndRegex_ = /\n\r?\n$/;
diff_match_patch.blanklineStartRegex_ = /^\r?\n\r?\n/;

/**
 * Reduce the number of edits by eliminating operationally trivial equalities.
 * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
 */
diff_match_patch.prototype.diff_cleanupEfficiency = function(diffs) {
  var changes = false;
  var equalities = [];  // Stack of indices where equalities are found.
  var equalitiesLength = 0;  // Keeping our own length var is faster in JS.
  /** @type {?string} */
  var lastEquality = null;
  // Always equal to diffs[equalities[equalitiesLength - 1]][1]
  var pointer = 0;  // Index of current position.
  // Is there an insertion operation before the last equality.
  var pre_ins = false;
  // Is there a deletion operation before the last equality.
  var pre_del = false;
  // Is there an insertion operation after the last equality.
  var post_ins = false;
  // Is there a deletion operation after the last equality.
  var post_del = false;
  while (pointer < diffs.length) {
    if (diffs[pointer][0] == DIFF_EQUAL) {  // Equality found.
      if (diffs[pointer][1].length < this.Diff_EditCost &&
          (post_ins || post_del)) {
        // Candidate found.
        equalities[equalitiesLength++] = pointer;
        pre_ins = post_ins;
        pre_del = post_del;
        lastEquality = diffs[pointer][1];
      } else {
        // Not a candidate, and can never become one.
        equalitiesLength = 0;
        lastEquality = null;
      }
      post_ins = post_del = false;
    } else {  // An insertion or deletion.
      if (diffs[pointer][0] == DIFF_DELETE) {
        post_del = true;
      } else {
        post_ins = true;
      }
      /*
       * Five types to be split:
       * <ins>A</ins><del>B</del>XY<ins>C</ins><del>D</del>
       * <ins>A</ins>X<ins>C</ins><del>D</del>
       * <ins>A</ins><del>B</del>X<ins>C</ins>
       * <ins>A</del>X<ins>C</ins><del>D</del>
       * <ins>A</ins><del>B</del>X<del>C</del>
       */
      if (lastEquality && ((pre_ins && pre_del && post_ins && post_del) ||
                           ((lastEquality.length < this.Diff_EditCost / 2) &&
                            (pre_ins + pre_del + post_ins + post_del) == 3))) {
        // Duplicate record.
        diffs.splice(equalities[equalitiesLength - 1], 0,
                     new diff_match_patch.Diff(DIFF_DELETE, lastEquality));
        // Change second copy to insert.
        diffs[equalities[equalitiesLength - 1] + 1][0] = DIFF_INSERT;
        equalitiesLength--;  // Throw away the equality we just deleted;
        lastEquality = null;
        if (pre_ins && pre_del) {
          // No changes made which could affect previous entry, keep going.
          post_ins = post_del = true;
          equalitiesLength = 0;
        } else {
          equalitiesLength--;  // Throw away the previous equality.
          pointer = equalitiesLength > 0 ?
              equalities[equalitiesLength - 1] : -1;
          post_ins = post_del = false;
        }
        changes = true;
      }
    }
    pointer++;
  }

  if (changes) {
    this.diff_cleanupMerge(diffs);
  }
};


/**
 * Reorder and merge like edit sections.  Merge equalities.
 * Any edit section can move as long as it doesn't cross an equality.
 * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
 */
diff_match_patch.prototype.diff_cleanupMerge = function(diffs) {
  // Add a dummy entry at the end.
  diffs.push(new diff_match_patch.Diff(DIFF_EQUAL, ''));
  var pointer = 0;
  var count_delete = 0;
  var count_insert = 0;
  var text_delete = '';
  var text_insert = '';
  var commonlength;
  while (pointer < diffs.length) {
    switch (diffs[pointer][0]) {
      case DIFF_INSERT:
        count_insert++;
        text_insert += diffs[pointer][1];
        pointer++;
        break;
      case DIFF_DELETE:
        count_delete++;
        text_delete += diffs[pointer][1];
        pointer++;
        break;
      case DIFF_EQUAL:
        // Upon reaching an equality, check for prior redundancies.
        if (count_delete + count_insert > 1) {
          if (count_delete !== 0 && count_insert !== 0) {
            // Factor out any common prefixies.
            commonlength = this.diff_commonPrefix(text_insert, text_delete);
            if (commonlength !== 0) {
              if ((pointer - count_delete - count_insert) > 0 &&
                  diffs[pointer - count_delete - count_insert - 1][0] ==
                  DIFF_EQUAL) {
                diffs[pointer - count_delete - count_insert - 1][1] +=
                    text_insert.substring(0, commonlength);
              } else {
                diffs.splice(0, 0, new diff_match_patch.Diff(DIFF_EQUAL,
                    text_insert.substring(0, commonlength)));
                pointer++;
              }
              text_insert = text_insert.substring(commonlength);
              text_delete = text_delete.substring(commonlength);
            }
            // Factor out any common suffixies.
            commonlength = this.diff_commonSuffix(text_insert, text_delete);
            if (commonlength !== 0) {
              diffs[pointer][1] = text_insert.substring(text_insert.length -
                  commonlength) + diffs[pointer][1];
              text_insert = text_insert.substring(0, text_insert.length -
                  commonlength);
              text_delete = text_delete.substring(0, text_delete.length -
                  commonlength);
            }
          }
          // Delete the offending records and add the merged ones.
          pointer -= count_delete + count_insert;
          diffs.splice(pointer, count_delete + count_insert);
          if (text_delete.length) {
            diffs.splice(pointer, 0,
                new diff_match_patch.Diff(DIFF_DELETE, text_delete));
            pointer++;
          }
          if (text_insert.length) {
            diffs.splice(pointer, 0,
                new diff_match_patch.Diff(DIFF_INSERT, text_insert));
            pointer++;
          }
          pointer++;
        } else if (pointer !== 0 && diffs[pointer - 1][0] == DIFF_EQUAL) {
          // Merge this equality with the previous one.
          diffs[pointer - 1][1] += diffs[pointer][1];
          diffs.splice(pointer, 1);
        } else {
          pointer++;
        }
        count_insert = 0;
        count_delete = 0;
        text_delete = '';
        text_insert = '';
        break;
    }
  }
  if (diffs[diffs.length - 1][1] === '') {
    diffs.pop();  // Remove the dummy entry at the end.
  }

  // Second pass: look for single edits surrounded on both sides by equalities
  // which can be shifted sideways to eliminate an equality.
  // e.g: A<ins>BA</ins>C -> <ins>AB</ins>AC
  var changes = false;
  pointer = 1;
  // Intentionally ignore the first and last element (don't need checking).
  while (pointer < diffs.length - 1) {
    if (diffs[pointer - 1][0] == DIFF_EQUAL &&
        diffs[pointer + 1][0] == DIFF_EQUAL) {
      // This is a single edit surrounded by equalities.
      if (diffs[pointer][1].substring(diffs[pointer][1].length -
          diffs[pointer - 1][1].length) == diffs[pointer - 1][1]) {
        // Shift the edit over the previous equality.
        diffs[pointer][1] = diffs[pointer - 1][1] +
            diffs[pointer][1].substring(0, diffs[pointer][1].length -
                                        diffs[pointer - 1][1].length);
        diffs[pointer + 1][1] = diffs[pointer - 1][1] + diffs[pointer + 1][1];
        diffs.splice(pointer - 1, 1);
        changes = true;
      } else if (diffs[pointer][1].substring(0, diffs[pointer + 1][1].length) ==
          diffs[pointer + 1][1]) {
        // Shift the edit over the next equality.
        diffs[pointer - 1][1] += diffs[pointer + 1][1];
        diffs[pointer][1] =
            diffs[pointer][1].substring(diffs[pointer + 1][1].length) +
            diffs[pointer + 1][1];
        diffs.splice(pointer + 1, 1);
        changes = true;
      }
    }
    pointer++;
  }
  // If shifts were made, the diff needs reordering and another shift sweep.
  if (changes) {
    this.diff_cleanupMerge(diffs);
  }
};


/**
 * loc is a location in text1, compute and return the equivalent location in
 * text2.
 * e.g. 'The cat' vs 'The big cat', 1->1, 5->8
 * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
 * @param {number} loc Location within text1.
 * @return {number} Location within text2.
 */
diff_match_patch.prototype.diff_xIndex = function(diffs, loc) {
  var chars1 = 0;
  var chars2 = 0;
  var last_chars1 = 0;
  var last_chars2 = 0;
  var x;
  for (x = 0; x < diffs.length; x++) {
    if (diffs[x][0] !== DIFF_INSERT) {  // Equality or deletion.
      chars1 += diffs[x][1].length;
    }
    if (diffs[x][0] !== DIFF_DELETE) {  // Equality or insertion.
      chars2 += diffs[x][1].length;
    }
    if (chars1 > loc) {  // Overshot the location.
      break;
    }
    last_chars1 = chars1;
    last_chars2 = chars2;
  }
  // Was the location was deleted?
  if (diffs.length != x && diffs[x][0] === DIFF_DELETE) {
    return last_chars2;
  }
  // Add the remaining character length.
  return last_chars2 + (loc - last_chars1);
};


/**
 * Convert a diff array into a pretty HTML report.
 * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
 * @return {string} HTML representation.
 */
diff_match_patch.prototype.diff_prettyHtml = function(diffs) {
  var html = [];
  var pattern_amp = /&/g;
  var pattern_lt = /</g;
  var pattern_gt = />/g;
  var pattern_para = /\n/g;
  for (var x = 0; x < diffs.length; x++) {
    var op = diffs[x][0];    // Operation (insert, delete, equal)
    var data = diffs[x][1];  // Text of change.
    var text = data.replace(pattern_amp, '&amp;').replace(pattern_lt, '&lt;')
        .replace(pattern_gt, '&gt;').replace(pattern_para, '&para;<br>');
    switch (op) {
      case DIFF_INSERT:
        html[x] = '<ins style="background:#e6ffe6;">' + text + '</ins>';
        break;
      case DIFF_DELETE:
        html[x] = '<del style="background:#ffe6e6;">' + text + '</del>';
        break;
      case DIFF_EQUAL:
        html[x] = '<span>' + text + '</span>';
        break;
    }
  }
  return html.join('');
};


/**
 * Compute and return the source text (all equalities and deletions).
 * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
 * @return {string} Source text.
 */
diff_match_patch.prototype.diff_text1 = function(diffs) {
  var text = [];
  for (var x = 0; x < diffs.length; x++) {
    if (diffs[x][0] !== DIFF_INSERT) {
      text[x] = diffs[x][1];
    }
  }
  return text.join('');
};


/**
 * Compute and return the destination text (all equalities and insertions).
 * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
 * @return {string} Destination text.
 */
diff_match_patch.prototype.diff_text2 = function(diffs) {
  var text = [];
  for (var x = 0; x < diffs.length; x++) {
    if (diffs[x][0] !== DIFF_DELETE) {
      text[x] = diffs[x][1];
    }
  }
  return text.join('');
};


/**
 * Compute the Levenshtein distance; the number of inserted, deleted or
 * substituted characters.
 * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
 * @return {number} Number of changes.
 */
diff_match_patch.prototype.diff_levenshtein = function(diffs) {
  var levenshtein = 0;
  var insertions = 0;
  var deletions = 0;
  for (var x = 0; x < diffs.length; x++) {
    var op = diffs[x][0];
    var data = diffs[x][1];
    switch (op) {
      case DIFF_INSERT:
        insertions += data.length;
        break;
      case DIFF_DELETE:
        deletions += data.length;
        break;
      case DIFF_EQUAL:
        // A deletion and an insertion is one substitution.
        levenshtein += Math.max(insertions, deletions);
        insertions = 0;
        deletions = 0;
        break;
    }
  }
  levenshtein += Math.max(insertions, deletions);
  return levenshtein;
};


/**
 * Crush the diff into an encoded string which describes the operations
 * required to transform text1 into text2.
 * E.g. =3\t-2\t+ing  -> Keep 3 chars, delete 2 chars, insert 'ing'.
 * Operations are tab-separated.  Inserted text is escaped using %xx notation.
 * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
 * @return {string} Delta text.
 */
diff_match_patch.prototype.diff_toDelta = function(diffs) {
  var text = [];
  for (var x = 0; x < diffs.length; x++) {
    switch (diffs[x][0]) {
      case DIFF_INSERT:
        text[x] = '+' + encodeURI(diffs[x][1]);
        break;
      case DIFF_DELETE:
        text[x] = '-' + diffs[x][1].length;
        break;
      case DIFF_EQUAL:
        text[x] = '=' + diffs[x][1].length;
        break;
    }
  }
  return text.join('\t').replace(/%20/g, ' ');
};


/**
 * Given the original text1, and an encoded string which describes the
 * operations required to transform text1 into text2, compute the full diff.
 * @param {string} text1 Source string for the diff.
 * @param {string} delta Delta text.
 * @return {!Array.<!diff_match_patch.Diff>} Array of diff tuples.
 * @throws {!Error} If invalid input.
 */
diff_match_patch.prototype.diff_fromDelta = function(text1, delta) {
  var diffs = [];
  var diffsLength = 0;  // Keeping our own length var is faster in JS.
  var pointer = 0;  // Cursor in text1
  var tokens = delta.split(/\t/g);
  for (var x = 0; x < tokens.length; x++) {
    // Each token begins with a one character parameter which specifies the
    // operation of this token (delete, insert, equality).
    var param = tokens[x].substring(1);
    switch (tokens[x].charAt(0)) {
      case '+':
        try {
          diffs[diffsLength++] =
              new diff_match_patch.Diff(DIFF_INSERT, decodeURI(param));
        } catch (ex) {
          // Malformed URI sequence.
          throw new Error('Illegal escape in diff_fromDelta: ' + param);
        }
        break;
      case '-':
        // Fall through.
      case '=':
        var n = parseInt(param, 10);
        if (isNaN(n) || n < 0) {
          throw new Error('Invalid number in diff_fromDelta: ' + param);
        }
        var text = text1.substring(pointer, pointer += n);
        if (tokens[x].charAt(0) == '=') {
          diffs[diffsLength++] = new diff_match_patch.Diff(DIFF_EQUAL, text);
        } else {
          diffs[diffsLength++] = new diff_match_patch.Diff(DIFF_DELETE, text);
        }
        break;
      default:
        // Blank tokens are ok (from a trailing \t).
        // Anything else is an error.
        if (tokens[x]) {
          throw new Error('Invalid diff operation in diff_fromDelta: ' +
                          tokens[x]);
        }
    }
  }
  if (pointer != text1.length) {
    throw new Error('Delta length (' + pointer +
        ') does not equal source text length (' + text1.length + ').');
  }
  return diffs;
};


//  MATCH FUNCTIONS


/**
 * Locate the best instance of 'pattern' in 'text' near 'loc'.
 * @param {string} text The text to search.
 * @param {string} pattern The pattern to search for.
 * @param {number} loc The location to search around.
 * @return {number} Best match index or -1.
 */
diff_match_patch.prototype.match_main = function(text, pattern, loc) {
  // Check for null inputs.
  if (text == null || pattern == null || loc == null) {
    throw new Error('Null input. (match_main)');
  }

  loc = Math.max(0, Math.min(loc, text.length));
  if (text == pattern) {
    // Shortcut (potentially not guaranteed by the algorithm)
    return 0;
  } else if (!text.length) {
    // Nothing to match.
    return -1;
  } else if (text.substring(loc, loc + pattern.length) == pattern) {
    // Perfect match at the perfect spot!  (Includes case of null pattern)
    return loc;
  } else {
    // Do a fuzzy compare.
    return this.match_bitap_(text, pattern, loc);
  }
};


/**
 * Locate the best instance of 'pattern' in 'text' near 'loc' using the
 * Bitap algorithm.
 * @param {string} text The text to search.
 * @param {string} pattern The pattern to search for.
 * @param {number} loc The location to search around.
 * @return {number} Best match index or -1.
 * @private
 */
diff_match_patch.prototype.match_bitap_ = function(text, pattern, loc) {
  if (pattern.length > this.Match_MaxBits) {
    throw new Error('Pattern too long for this browser.');
  }

  // Initialise the alphabet.
  var s = this.match_alphabet_(pattern);

  var dmp = this;  // 'this' becomes 'window' in a closure.

  /**
   * Compute and return the score for a match with e errors and x location.
   * Accesses loc and pattern through being a closure.
   * @param {number} e Number of errors in match.
   * @param {number} x Location of match.
   * @return {number} Overall score for match (0.0 = good, 1.0 = bad).
   * @private
   */
  function match_bitapScore_(e, x) {
    var accuracy = e / pattern.length;
    var proximity = Math.abs(loc - x);
    if (!dmp.Match_Distance) {
      // Dodge divide by zero error.
      return proximity ? 1.0 : accuracy;
    }
    return accuracy + (proximity / dmp.Match_Distance);
  }

  // Highest score beyond which we give up.
  var score_threshold = this.Match_Threshold;
  // Is there a nearby exact match? (speedup)
  var best_loc = text.indexOf(pattern, loc);
  if (best_loc != -1) {
    score_threshold = Math.min(match_bitapScore_(0, best_loc), score_threshold);
    // What about in the other direction? (speedup)
    best_loc = text.lastIndexOf(pattern, loc + pattern.length);
    if (best_loc != -1) {
      score_threshold =
          Math.min(match_bitapScore_(0, best_loc), score_threshold);
    }
  }

  // Initialise the bit arrays.
  var matchmask = 1 << (pattern.length - 1);
  best_loc = -1;

  var bin_min, bin_mid;
  var bin_max = pattern.length + text.length;
  var last_rd;
  for (var d = 0; d < pattern.length; d++) {
    // Scan for the best match; each iteration allows for one more error.
    // Run a binary search to determine how far from 'loc' we can stray at this
    // error level.
    bin_min = 0;
    bin_mid = bin_max;
    while (bin_min < bin_mid) {
      if (match_bitapScore_(d, loc + bin_mid) <= score_threshold) {
        bin_min = bin_mid;
      } else {
        bin_max = bin_mid;
      }
      bin_mid = Math.floor((bin_max - bin_min) / 2 + bin_min);
    }
    // Use the result from this iteration as the maximum for the next.
    bin_max = bin_mid;
    var start = Math.max(1, loc - bin_mid + 1);
    var finish = Math.min(loc + bin_mid, text.length) + pattern.length;

    var rd = Array(finish + 2);
    rd[finish + 1] = (1 << d) - 1;
    for (var j = finish; j >= start; j--) {
      // The alphabet (s) is a sparse hash, so the following line generates
      // warnings.
      var charMatch = s[text.charAt(j - 1)];
      if (d === 0) {  // First pass: exact match.
        rd[j] = ((rd[j + 1] << 1) | 1) & charMatch;
      } else {  // Subsequent passes: fuzzy match.
        rd[j] = (((rd[j + 1] << 1) | 1) & charMatch) |
                (((last_rd[j + 1] | last_rd[j]) << 1) | 1) |
                last_rd[j + 1];
      }
      if (rd[j] & matchmask) {
        var score = match_bitapScore_(d, j - 1);
        // This match will almost certainly be better than any existing match.
        // But check anyway.
        if (score <= score_threshold) {
          // Told you so.
          score_threshold = score;
          best_loc = j - 1;
          if (best_loc > loc) {
            // When passing loc, don't exceed our current distance from loc.
            start = Math.max(1, 2 * loc - best_loc);
          } else {
            // Already passed loc, downhill from here on in.
            break;
          }
        }
      }
    }
    // No hope for a (better) match at greater error levels.
    if (match_bitapScore_(d + 1, loc) > score_threshold) {
      break;
    }
    last_rd = rd;
  }
  return best_loc;
};


/**
 * Initialise the alphabet for the Bitap algorithm.
 * @param {string} pattern The text to encode.
 * @return {!Object} Hash of character locations.
 * @private
 */
diff_match_patch.prototype.match_alphabet_ = function(pattern) {
  var s = {};
  for (var i = 0; i < pattern.length; i++) {
    s[pattern.charAt(i)] = 0;
  }
  for (var i = 0; i < pattern.length; i++) {
    s[pattern.charAt(i)] |= 1 << (pattern.length - i - 1);
  }
  return s;
};


//  PATCH FUNCTIONS


/**
 * Increase the context until it is unique,
 * but don't let the pattern expand beyond Match_MaxBits.
 * @param {!diff_match_patch.patch_obj} patch The patch to grow.
 * @param {string} text Source text.
 * @private
 */
diff_match_patch.prototype.patch_addContext_ = function(patch, text) {
  if (text.length == 0) {
    return;
  }
  if (patch.start2 === null) {
    throw Error('patch not initialized');
  }
  var pattern = text.substring(patch.start2, patch.start2 + patch.length1);
  var padding = 0;

  // Look for the first and last matches of pattern in text.  If two different
  // matches are found, increase the pattern length.
  while (text.indexOf(pattern) != text.lastIndexOf(pattern) &&
         pattern.length < this.Match_MaxBits - this.Patch_Margin -
         this.Patch_Margin) {
    padding += this.Patch_Margin;
    pattern = text.substring(patch.start2 - padding,
                             patch.start2 + patch.length1 + padding);
  }
  // Add one chunk for good luck.
  padding += this.Patch_Margin;

  // Add the prefix.
  var prefix = text.substring(patch.start2 - padding, patch.start2);
  if (prefix) {
    patch.diffs.unshift(new diff_match_patch.Diff(DIFF_EQUAL, prefix));
  }
  // Add the suffix.
  var suffix = text.substring(patch.start2 + patch.length1,
                              patch.start2 + patch.length1 + padding);
  if (suffix) {
    patch.diffs.push(new diff_match_patch.Diff(DIFF_EQUAL, suffix));
  }

  // Roll back the start points.
  patch.start1 -= prefix.length;
  patch.start2 -= prefix.length;
  // Extend the lengths.
  patch.length1 += prefix.length + suffix.length;
  patch.length2 += prefix.length + suffix.length;
};


/**
 * Compute a list of patches to turn text1 into text2.
 * Use diffs if provided, otherwise compute it ourselves.
 * There are four ways to call this function, depending on what data is
 * available to the caller:
 * Method 1:
 * a = text1, b = text2
 * Method 2:
 * a = diffs
 * Method 3 (optimal):
 * a = text1, b = diffs
 * Method 4 (deprecated, use method 3):
 * a = text1, b = text2, c = diffs
 *
 * @param {string|!Array.<!diff_match_patch.Diff>} a text1 (methods 1,3,4) or
 * Array of diff tuples for text1 to text2 (method 2).
 * @param {string|!Array.<!diff_match_patch.Diff>=} opt_b text2 (methods 1,4) or
 * Array of diff tuples for text1 to text2 (method 3) or undefined (method 2).
 * @param {string|!Array.<!diff_match_patch.Diff>=} opt_c Array of diff tuples
 * for text1 to text2 (method 4) or undefined (methods 1,2,3).
 * @return {!Array.<!diff_match_patch.patch_obj>} Array of Patch objects.
 */
diff_match_patch.prototype.patch_make = function(a, opt_b, opt_c) {
  var text1, diffs;
  if (typeof a == 'string' && typeof opt_b == 'string' &&
      typeof opt_c == 'undefined') {
    // Method 1: text1, text2
    // Compute diffs from text1 and text2.
    text1 = /** @type {string} */(a);
    diffs = this.diff_main(text1, /** @type {string} */(opt_b), true);
    if (diffs.length > 2) {
      this.diff_cleanupSemantic(diffs);
      this.diff_cleanupEfficiency(diffs);
    }
  } else if (a && typeof a == 'object' && typeof opt_b == 'undefined' &&
      typeof opt_c == 'undefined') {
    // Method 2: diffs
    // Compute text1 from diffs.
    diffs = /** @type {!Array.<!diff_match_patch.Diff>} */(a);
    text1 = this.diff_text1(diffs);
  } else if (typeof a == 'string' && opt_b && typeof opt_b == 'object' &&
      typeof opt_c == 'undefined') {
    // Method 3: text1, diffs
    text1 = /** @type {string} */(a);
    diffs = /** @type {!Array.<!diff_match_patch.Diff>} */(opt_b);
  } else if (typeof a == 'string' && typeof opt_b == 'string' &&
      opt_c && typeof opt_c == 'object') {
    // Method 4: text1, text2, diffs
    // text2 is not used.
    text1 = /** @type {string} */(a);
    diffs = /** @type {!Array.<!diff_match_patch.Diff>} */(opt_c);
  } else {
    throw new Error('Unknown call format to patch_make.');
  }

  if (diffs.length === 0) {
    return [];  // Get rid of the null case.
  }
  var patches = [];
  var patch = new diff_match_patch.patch_obj();
  var patchDiffLength = 0;  // Keeping our own length var is faster in JS.
  var char_count1 = 0;  // Number of characters into the text1 string.
  var char_count2 = 0;  // Number of characters into the text2 string.
  // Start with text1 (prepatch_text) and apply the diffs until we arrive at
  // text2 (postpatch_text).  We recreate the patches one by one to determine
  // context info.
  var prepatch_text = text1;
  var postpatch_text = text1;
  for (var x = 0; x < diffs.length; x++) {
    var diff_type = diffs[x][0];
    var diff_text = diffs[x][1];

    if (!patchDiffLength && diff_type !== DIFF_EQUAL) {
      // A new patch starts here.
      patch.start1 = char_count1;
      patch.start2 = char_count2;
    }

    switch (diff_type) {
      case DIFF_INSERT:
        patch.diffs[patchDiffLength++] = diffs[x];
        patch.length2 += diff_text.length;
        postpatch_text = postpatch_text.substring(0, char_count2) + diff_text +
                         postpatch_text.substring(char_count2);
        break;
      case DIFF_DELETE:
        patch.length1 += diff_text.length;
        patch.diffs[patchDiffLength++] = diffs[x];
        postpatch_text = postpatch_text.substring(0, char_count2) +
                         postpatch_text.substring(char_count2 +
                             diff_text.length);
        break;
      case DIFF_EQUAL:
        if (diff_text.length <= 2 * this.Patch_Margin &&
            patchDiffLength && diffs.length != x + 1) {
          // Small equality inside a patch.
          patch.diffs[patchDiffLength++] = diffs[x];
          patch.length1 += diff_text.length;
          patch.length2 += diff_text.length;
        } else if (diff_text.length >= 2 * this.Patch_Margin) {
          // Time for a new patch.
          if (patchDiffLength) {
            this.patch_addContext_(patch, prepatch_text);
            patches.push(patch);
            patch = new diff_match_patch.patch_obj();
            patchDiffLength = 0;
            // Unlike Unidiff, our patch lists have a rolling context.
            // https://github.com/google/diff-match-patch/wiki/Unidiff
            // Update prepatch text & pos to reflect the application of the
            // just completed patch.
            prepatch_text = postpatch_text;
            char_count1 = char_count2;
          }
        }
        break;
    }

    // Update the current character count.
    if (diff_type !== DIFF_INSERT) {
      char_count1 += diff_text.length;
    }
    if (diff_type !== DIFF_DELETE) {
      char_count2 += diff_text.length;
    }
  }
  // Pick up the leftover patch if not empty.
  if (patchDiffLength) {
    this.patch_addContext_(patch, prepatch_text);
    patches.push(patch);
  }

  return patches;
};


/**
 * Given an array of patches, return another array that is identical.
 * @param {!Array.<!diff_match_patch.patch_obj>} patches Array of Patch objects.
 * @return {!Array.<!diff_match_patch.patch_obj>} Array of Patch objects.
 */
diff_match_patch.prototype.patch_deepCopy = function(patches) {
  // Making deep copies is hard in JavaScript.
  var patchesCopy = [];
  for (var x = 0; x < patches.length; x++) {
    var patch = patches[x];
    var patchCopy = new diff_match_patch.patch_obj();
    patchCopy.diffs = [];
    for (var y = 0; y < patch.diffs.length; y++) {
      patchCopy.diffs[y] =
          new diff_match_patch.Diff(patch.diffs[y][0], patch.diffs[y][1]);
    }
    patchCopy.start1 = patch.start1;
    patchCopy.start2 = patch.start2;
    patchCopy.length1 = patch.length1;
    patchCopy.length2 = patch.length2;
    patchesCopy[x] = patchCopy;
  }
  return patchesCopy;
};


/**
 * Merge a set of patches onto the text.  Return a patched text, as well
 * as a list of true/false values indicating which patches were applied.
 * @param {!Array.<!diff_match_patch.patch_obj>} patches Array of Patch objects.
 * @param {string} text Old text.
 * @return {!Array.<string|!Array.<boolean>>} Two element Array, containing the
 *      new text and an array of boolean values.
 */
diff_match_patch.prototype.patch_apply = function(patches, text) {
  if (patches.length == 0) {
    return [text, []];
  }

  // Deep copy the patches so that no changes are made to originals.
  patches = this.patch_deepCopy(patches);

  var nullPadding = this.patch_addPadding(patches);
  text = nullPadding + text + nullPadding;

  this.patch_splitMax(patches);
  // delta keeps track of the offset between the expected and actual location
  // of the previous patch.  If there are patches expected at positions 10 and
  // 20, but the first patch was found at 12, delta is 2 and the second patch
  // has an effective expected position of 22.
  var delta = 0;
  var results = [];
  for (var x = 0; x < patches.length; x++) {
    var expected_loc = patches[x].start2 + delta;
    var text1 = this.diff_text1(patches[x].diffs);
    var start_loc;
    var end_loc = -1;
    if (text1.length > this.Match_MaxBits) {
      // patch_splitMax will only provide an oversized pattern in the case of
      // a monster delete.
      start_loc = this.match_main(text, text1.substring(0, this.Match_MaxBits),
                                  expected_loc);
      if (start_loc != -1) {
        end_loc = this.match_main(text,
            text1.substring(text1.length - this.Match_MaxBits),
            expected_loc + text1.length - this.Match_MaxBits);
        if (end_loc == -1 || start_loc >= end_loc) {
          // Can't find valid trailing context.  Drop this patch.
          start_loc = -1;
        }
      }
    } else {
      start_loc = this.match_main(text, text1, expected_loc);
    }
    if (start_loc == -1) {
      // No match found.  :(
      results[x] = false;
      // Subtract the delta for this failed patch from subsequent patches.
      delta -= patches[x].length2 - patches[x].length1;
    } else {
      // Found a match.  :)
      results[x] = true;
      delta = start_loc - expected_loc;
      var text2;
      if (end_loc == -1) {
        text2 = text.substring(start_loc, start_loc + text1.length);
      } else {
        text2 = text.substring(start_loc, end_loc + this.Match_MaxBits);
      }
      if (text1 == text2) {
        // Perfect match, just shove the replacement text in.
        text = text.substring(0, start_loc) +
               this.diff_text2(patches[x].diffs) +
               text.substring(start_loc + text1.length);
      } else {
        // Imperfect match.  Run a diff to get a framework of equivalent
        // indices.
        var diffs = this.diff_main(text1, text2, false);
        if (text1.length > this.Match_MaxBits &&
            this.diff_levenshtein(diffs) / text1.length >
            this.Patch_DeleteThreshold) {
          // The end points match, but the content is unacceptably bad.
          results[x] = false;
        } else {
          this.diff_cleanupSemanticLossless(diffs);
          var index1 = 0;
          var index2;
          for (var y = 0; y < patches[x].diffs.length; y++) {
            var mod = patches[x].diffs[y];
            if (mod[0] !== DIFF_EQUAL) {
              index2 = this.diff_xIndex(diffs, index1);
            }
            if (mod[0] === DIFF_INSERT) {  // Insertion
              text = text.substring(0, start_loc + index2) + mod[1] +
                     text.substring(start_loc + index2);
            } else if (mod[0] === DIFF_DELETE) {  // Deletion
              text = text.substring(0, start_loc + index2) +
                     text.substring(start_loc + this.diff_xIndex(diffs,
                         index1 + mod[1].length));
            }
            if (mod[0] !== DIFF_DELETE) {
              index1 += mod[1].length;
            }
          }
        }
      }
    }
  }
  // Strip the padding off.
  text = text.substring(nullPadding.length, text.length - nullPadding.length);
  return [text, results];
};


/**
 * Add some padding on text start and end so that edges can match something.
 * Intended to be called only from within patch_apply.
 * @param {!Array.<!diff_match_patch.patch_obj>} patches Array of Patch objects.
 * @return {string} The padding string added to each side.
 */
diff_match_patch.prototype.patch_addPadding = function(patches) {
  var paddingLength = this.Patch_Margin;
  var nullPadding = '';
  for (var x = 1; x <= paddingLength; x++) {
    nullPadding += String.fromCharCode(x);
  }

  // Bump all the patches forward.
  for (var x = 0; x < patches.length; x++) {
    patches[x].start1 += paddingLength;
    patches[x].start2 += paddingLength;
  }

  // Add some padding on start of first diff.
  var patch = patches[0];
  var diffs = patch.diffs;
  if (diffs.length == 0 || diffs[0][0] != DIFF_EQUAL) {
    // Add nullPadding equality.
    diffs.unshift(new diff_match_patch.Diff(DIFF_EQUAL, nullPadding));
    patch.start1 -= paddingLength;  // Should be 0.
    patch.start2 -= paddingLength;  // Should be 0.
    patch.length1 += paddingLength;
    patch.length2 += paddingLength;
  } else if (paddingLength > diffs[0][1].length) {
    // Grow first equality.
    var extraLength = paddingLength - diffs[0][1].length;
    diffs[0][1] = nullPadding.substring(diffs[0][1].length) + diffs[0][1];
    patch.start1 -= extraLength;
    patch.start2 -= extraLength;
    patch.length1 += extraLength;
    patch.length2 += extraLength;
  }

  // Add some padding on end of last diff.
  patch = patches[patches.length - 1];
  diffs = patch.diffs;
  if (diffs.length == 0 || diffs[diffs.length - 1][0] != DIFF_EQUAL) {
    // Add nullPadding equality.
    diffs.push(new diff_match_patch.Diff(DIFF_EQUAL, nullPadding));
    patch.length1 += paddingLength;
    patch.length2 += paddingLength;
  } else if (paddingLength > diffs[diffs.length - 1][1].length) {
    // Grow last equality.
    var extraLength = paddingLength - diffs[diffs.length - 1][1].length;
    diffs[diffs.length - 1][1] += nullPadding.substring(0, extraLength);
    patch.length1 += extraLength;
    patch.length2 += extraLength;
  }

  return nullPadding;
};


/**
 * Look through the patches and break up any which are longer than the maximum
 * limit of the match algorithm.
 * Intended to be called only from within patch_apply.
 * @param {!Array.<!diff_match_patch.patch_obj>} patches Array of Patch objects.
 */
diff_match_patch.prototype.patch_splitMax = function(patches) {
  var patch_size = this.Match_MaxBits;
  for (var x = 0; x < patches.length; x++) {
    if (patches[x].length1 <= patch_size) {
      continue;
    }
    var bigpatch = patches[x];
    // Remove the big old patch.
    patches.splice(x--, 1);
    var start1 = bigpatch.start1;
    var start2 = bigpatch.start2;
    var precontext = '';
    while (bigpatch.diffs.length !== 0) {
      // Create one of several smaller patches.
      var patch = new diff_match_patch.patch_obj();
      var empty = true;
      patch.start1 = start1 - precontext.length;
      patch.start2 = start2 - precontext.length;
      if (precontext !== '') {
        patch.length1 = patch.length2 = precontext.length;
        patch.diffs.push(new diff_match_patch.Diff(DIFF_EQUAL, precontext));
      }
      while (bigpatch.diffs.length !== 0 &&
             patch.length1 < patch_size - this.Patch_Margin) {
        var diff_type = bigpatch.diffs[0][0];
        var diff_text = bigpatch.diffs[0][1];
        if (diff_type === DIFF_INSERT) {
          // Insertions are harmless.
          patch.length2 += diff_text.length;
          start2 += diff_text.length;
          patch.diffs.push(bigpatch.diffs.shift());
          empty = false;
        } else if (diff_type === DIFF_DELETE && patch.diffs.length == 1 &&
                   patch.diffs[0][0] == DIFF_EQUAL &&
                   diff_text.length > 2 * patch_size) {
          // This is a large deletion.  Let it pass in one chunk.
          patch.length1 += diff_text.length;
          start1 += diff_text.length;
          empty = false;
          patch.diffs.push(new diff_match_patch.Diff(diff_type, diff_text));
          bigpatch.diffs.shift();
        } else {
          // Deletion or equality.  Only take as much as we can stomach.
          diff_text = diff_text.substring(0,
              patch_size - patch.length1 - this.Patch_Margin);
          patch.length1 += diff_text.length;
          start1 += diff_text.length;
          if (diff_type === DIFF_EQUAL) {
            patch.length2 += diff_text.length;
            start2 += diff_text.length;
          } else {
            empty = false;
          }
          patch.diffs.push(new diff_match_patch.Diff(diff_type, diff_text));
          if (diff_text == bigpatch.diffs[0][1]) {
            bigpatch.diffs.shift();
          } else {
            bigpatch.diffs[0][1] =
                bigpatch.diffs[0][1].substring(diff_text.length);
          }
        }
      }
      // Compute the head context for the next patch.
      precontext = this.diff_text2(patch.diffs);
      precontext =
          precontext.substring(precontext.length - this.Patch_Margin);
      // Append the end context for this patch.
      var postcontext = this.diff_text1(bigpatch.diffs)
                            .substring(0, this.Patch_Margin);
      if (postcontext !== '') {
        patch.length1 += postcontext.length;
        patch.length2 += postcontext.length;
        if (patch.diffs.length !== 0 &&
            patch.diffs[patch.diffs.length - 1][0] === DIFF_EQUAL) {
          patch.diffs[patch.diffs.length - 1][1] += postcontext;
        } else {
          patch.diffs.push(new diff_match_patch.Diff(DIFF_EQUAL, postcontext));
        }
      }
      if (!empty) {
        patches.splice(++x, 0, patch);
      }
    }
  }
};


/**
 * Take a list of patches and return a textual representation.
 * @param {!Array.<!diff_match_patch.patch_obj>} patches Array of Patch objects.
 * @return {string} Text representation of patches.
 */
diff_match_patch.prototype.patch_toText = function(patches) {
  var text = [];
  for (var x = 0; x < patches.length; x++) {
    text[x] = patches[x];
  }
  return text.join('');
};


/**
 * Parse a textual representation of patches and return a list of Patch objects.
 * @param {string} textline Text representation of patches.
 * @return {!Array.<!diff_match_patch.patch_obj>} Array of Patch objects.
 * @throws {!Error} If invalid input.
 */
diff_match_patch.prototype.patch_fromText = function(textline) {
  var patches = [];
  if (!textline) {
    return patches;
  }
  var text = textline.split('\n');
  var textPointer = 0;
  var patchHeader = /^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@$/;
  while (textPointer < text.length) {
    var m = text[textPointer].match(patchHeader);
    if (!m) {
      throw new Error('Invalid patch string: ' + text[textPointer]);
    }
    var patch = new diff_match_patch.patch_obj();
    patches.push(patch);
    patch.start1 = parseInt(m[1], 10);
    if (m[2] === '') {
      patch.start1--;
      patch.length1 = 1;
    } else if (m[2] == '0') {
      patch.length1 = 0;
    } else {
      patch.start1--;
      patch.length1 = parseInt(m[2], 10);
    }

    patch.start2 = parseInt(m[3], 10);
    if (m[4] === '') {
      patch.start2--;
      patch.length2 = 1;
    } else if (m[4] == '0') {
      patch.length2 = 0;
    } else {
      patch.start2--;
      patch.length2 = parseInt(m[4], 10);
    }
    textPointer++;

    while (textPointer < text.length) {
      var sign = text[textPointer].charAt(0);
      try {
        var line = decodeURI(text[textPointer].substring(1));
      } catch (ex) {
        // Malformed URI sequence.
        throw new Error('Illegal escape in patch_fromText: ' + line);
      }
      if (sign == '-') {
        // Deletion.
        patch.diffs.push(new diff_match_patch.Diff(DIFF_DELETE, line));
      } else if (sign == '+') {
        // Insertion.
        patch.diffs.push(new diff_match_patch.Diff(DIFF_INSERT, line));
      } else if (sign == ' ') {
        // Minor equality.
        patch.diffs.push(new diff_match_patch.Diff(DIFF_EQUAL, line));
      } else if (sign == '@') {
        // Start of next patch.
        break;
      } else if (sign === '') {
        // Blank line?  Whatever.
      } else {
        // WTF?
        throw new Error('Invalid patch mode "' + sign + '" in: ' + line);
      }
      textPointer++;
    }
  }
  return patches;
};


/**
 * Class representing one patch operation.
 * @constructor
 */
diff_match_patch.patch_obj = function() {
  /** @type {!Array.<!diff_match_patch.Diff>} */
  this.diffs = [];
  /** @type {?number} */
  this.start1 = null;
  /** @type {?number} */
  this.start2 = null;
  /** @type {number} */
  this.length1 = 0;
  /** @type {number} */
  this.length2 = 0;
};


/**
 * Emulate GNU diff's format.
 * Header: @@ -382,8 +481,9 @@
 * Indices are printed as 1-based, not 0-based.
 * @return {string} The GNU diff string.
 */
diff_match_patch.patch_obj.prototype.toString = function() {
  var coords1, coords2;
  if (this.length1 === 0) {
    coords1 = this.start1 + ',0';
  } else if (this.length1 == 1) {
    coords1 = this.start1 + 1;
  } else {
    coords1 = (this.start1 + 1) + ',' + this.length1;
  }
  if (this.length2 === 0) {
    coords2 = this.start2 + ',0';
  } else if (this.length2 == 1) {
    coords2 = this.start2 + 1;
  } else {
    coords2 = (this.start2 + 1) + ',' + this.length2;
  }
  var text = ['@@ -' + coords1 + ' +' + coords2 + ' @@\n'];
  var op;
  // Escape the body of the patch with %xx notation.
  for (var x = 0; x < this.diffs.length; x++) {
    switch (this.diffs[x][0]) {
      case DIFF_INSERT:
        op = '+';
        break;
      case DIFF_DELETE:
        op = '-';
        break;
      case DIFF_EQUAL:
        op = ' ';
        break;
    }
    text[x + 1] = op + encodeURI(this.diffs[x][1]) + '\n';
  }
  return text.join('').replace(/%20/g, ' ');
};

// CLOSURE:begin_strip
// Lines below here will not be included in the Closure-compatible library.

// Export these global variables so that they survive Google's JS compiler.
// In a browser, 'this' will be 'window'.
// Users of node.js should 'require' the uncompressed version since Google's
// JS compiler may break the following exports for non-browser environments.
/** @suppress {globalThis} */
this['diff_match_patch'] = diff_match_patch;
/** @suppress {globalThis} */
this['DIFF_DELETE'] = DIFF_DELETE;
/** @suppress {globalThis} */
this['DIFF_INSERT'] = DIFF_INSERT;
/** @suppress {globalThis} */
this['DIFF_EQUAL'] = DIFF_EQUAL;

// ----- File: src/Bookmark.js -----
/**
 * Bookmark.js — bookmark（設定/移動/削除）と goto（現在地の移動）。
 *
 * Jujutsu 流モデル: 現在地 working はコミットID（匿名ヘッド @）。ブックマークは手動で付ける
 * 名前付きポインタで、commit では自動前進しない（明示的に set/move したときだけ動く）。
 * 作業コピーはアクティブタブ1枚で、goto はその本文をその場で対象コミットの内容に入れ替える
 * （GAS のタブ生成・別インスタンス書き込み・アクティブタブ切替の制約を回避する。付録B/C）。
 */

/**
 * ブックマークを設定/移動する（git branch -f 相当・jj bookmark set）。
 * commitId 既定＝現在地 working。既存同名は移動になる。設定後の { name, commitId } を返す。
 */
function Ggit_bookmarkSet(name, commitId) {
  name = (name || '').trim();
  if (!name) throw new Error('ブックマーク名が空です。');
  if (name === GGIT_META_TITLE) {
    throw new Error('「' + GGIT_META_TITLE + '」は予約名です。別の名前を指定してください。');
  }

  var doc = DocumentApp.getActiveDocument();
  var store = Ggit_storeLoad(doc);

  var target = commitId || Ggit_resolveWorking(doc, store);
  if (!target) {
    throw new Error('指す先のコミットがありません。先にコミットしてください。');
  }
  if (!store.objects.hasOwnProperty(target)) {
    throw new Error('コミットが見つかりません: ' + target);
  }

  store.bookmarks[name] = target;
  Ggit_storeSave(doc, store);
  return { name: name, commitId: target };
}

/** ブックマークを削除する（git branch -d 相当）。戻り値: { name, deleted }。 */
function Ggit_bookmarkDelete(name) {
  name = (name || '').trim();
  var doc = DocumentApp.getActiveDocument();
  var store = Ggit_storeLoad(doc);
  if (!store.bookmarks.hasOwnProperty(name)) {
    throw new Error('ブックマークが見つかりません: ' + name);
  }
  delete store.bookmarks[name];
  Ggit_storeSave(doc, store);
  return { name: name, deleted: true };
}

/** 全ブックマークを {name, commitId} の配列で返す。 */
function Ggit_bookmarkList() {
  var doc = DocumentApp.getActiveDocument();
  var store = Ggit_storeLoad(doc);
  var out = [];
  for (var name in store.bookmarks) {
    if (store.bookmarks.hasOwnProperty(name)) out.push({ name: name, commitId: store.bookmarks[name] });
  }
  return out;
}

/**
 * 現在地 working を target（ブックマーク名 または コミットID）へ移動する（jj edit / git checkout 相当）。
 * 作業タブ本文を対象コミットの内容（テキスト＋書式）で置き換え、置き換えで失われる未コミット内容は
 * スタッシュ（仮コミット）へ退避する。戻り値: { target, commitId, stashed }。
 */
function Ggit_goto(target) {
  var doc = DocumentApp.getActiveDocument();
  var tab = doc.getActiveTab();

  var meta = Ggit_metaTab(doc);
  if (meta && tab.getId() === meta.getId()) {
    throw new Error('.vcs メタタブ上では移動できません。対象のタブを選択してください。');
  }

  var store = Ggit_storeLoad(doc);

  // target をコミットIDへ解決（ブランチ名優先、無ければコミットIDとみなす）。
  var commitId = store.bookmarks.hasOwnProperty(target) ? store.bookmarks[target] : target;
  if (!store.objects.hasOwnProperty(commitId)) {
    throw new Error('移動先が見つかりません: ' + target);
  }
  // スタッシュは DAG の葉（退避ポケット）であり、その上に履歴を積めない。@ をスタッシュへ
  // 乗せるとそこでコミットした実コミットがスタッシュを親に持ち、破棄時に孤立する。
  // よってスタッシュへの移動は禁止し、内容が欲しければ pop、不要なら破棄へ誘導する。
  if (store.objects[commitId].stash) {
    throw new Error(
      'スタッシュへは移動できません。スタッシュ一覧の「戻す(pop)」で内容を取り込むか、' +
      '「破棄」してください。');
  }

  var cur = Ggit_resolveWorking(doc, store);
  var targetSnap = Ggit_materialize(store, commitId);
  var curSnap = Ggit_serializeTab(tab);

  var stashed = false;
  if (curSnap !== targetSnap) {
    // 現在の未コミット内容を退避してから対象コミットの内容を復元する。
    stashed = Ggit_stashIfNeeded(
      store, tab, cur, curSnap,
      '移動前の自動スタッシュ' + (cur ? '（' + cur + '）' : ''));
    Ggit_restoreTab(tab, targetSnap); // テキスト＋書式ごと入れ替え
  }
  store.working = commitId;
  Ggit_storeSave(doc, store);
  return { target: target, commitId: commitId, stashed: stashed };
}

// ----- File: src/Commit.js -----
/**
 * Commit.js — commit / log。
 *
 * 設計仕様書 §6: commit はアクティブタブ本文をスナップショット化し、
 * 親＝現在地 working として新コミットを記録、working（現在地 @）を新コミットへ前進させる。
 * Jujutsu と同様、ブックマークは commit では動かさない（明示操作でのみ移動）。
 */

/**
 * コミット作者の表示名（ユーザー名）。People API（要 userinfo.profile スコープ）で
 * 自分のプロフィール名を引く。取得できなければ空文字。
 * 一次名（metadata.primary）を優先し、無ければ先頭の displayName を使う。
 */
function Ggit_authorName_() {
  try {
    var resp = People.People.get('people/me', { personFields: 'names' });
    var names = (resp && resp.names) || [];
    for (var i = 0; i < names.length; i++) {
      if (names[i].metadata && names[i].metadata.primary && names[i].displayName) {
        return names[i].displayName;
      }
    }
    if (names.length && names[0].displayName) return names[0].displayName;
  } catch (_) {}
  return '';
}

/** コミット作者のメールアドレス（要 userinfo.email スコープ）。取得できなければ空文字。 */
function Ggit_authorEmail_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (_) {
    return '';
  }
}

/**
 * コミット作者を git 形式の識別子「ユーザー名 <メールアドレス>」で返す。
 *  - 名前・メールが揃う … "名前 <メール>"
 *  - メールのみ取得     … "メール"
 *  - 名前のみ取得       … "名前"
 *  - どちらも取れない   … 'unknown'
 * 旧コミット（author が生メールのみ）とも互換: author は単一文字列のまま。
 */
function Ggit_author() {
  var name = Ggit_authorName_();
  var email = Ggit_authorEmail_();
  if (name && email) return name + ' <' + email + '>';
  if (email) return email;
  if (name) return name;
  return 'unknown';
}

/** ISO8601（タイムゾーンオフセット付き）のタイムスタンプ。 */
function Ggit_timestamp() {
  var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  return Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/**
 * アクティブタブ本文をコミットする。コミットIDを返す。
 * 変更が無い（前回コミットと同一本文）場合は例外を投げる。
 */
function Ggit_commit(message) {
  var doc = DocumentApp.getActiveDocument();
  var tab = doc.getActiveTab();
  var tabId = tab.getId();

  var meta = Ggit_metaTab(doc);
  if (meta && tabId === meta.getId()) {
    throw new Error('.vcs メタタブはコミットできません。対象のタブを選択してください。');
  }

  var snap = Ggit_serializeTab(tab); // テキスト＋書式の構造化スナップショット
  var store = Ggit_storeLoad(doc);

  // 親＝現在地 working。初回（未確立）は parent=null。
  var parent = Ggit_resolveWorking(doc, store);

  // 防御: 現在地が（移行データ等で）スタッシュを指している場合、スタッシュは履歴の親に
  // なってはならない。実在する直近の非スタッシュ祖先へ繋ぎ直す（無ければ初回扱い null）。
  // Ggit_goto はスタッシュへの移動を禁止しているため通常はここを通らない。
  if (parent && store.objects[parent] && store.objects[parent].stash) {
    parent = Ggit_firstNonStashAncestor_(store, parent);
  }

  if (parent && Ggit_materialize(store, parent) === snap) {
    throw new Error('変更がありません（前回コミットと同一の内容です）。');
  }

  var ts = Ggit_timestamp();
  var id = Ggit_commitId(store, parent, ts, snap);
  var payload = Ggit_makePayload(store, parent, snap);

  store.objects[id] = {
    id: id,
    parent: parent,
    parent2: null,
    message: message,
    author: Ggit_author(),
    timestamp: ts,
    payload: payload
  };
  store.working = id; // 現在地 @ のみ前進（ブックマークは動かさない＝jj）

  Ggit_storeSave(doc, store);
  return id;
}

/**
 * id（自身を含む）から親方向へ辿り、最初に現れる「実在する非スタッシュ」コミットIDを返す。
 * スタッシュ（stash:true）は飛ばす。連鎖が途中で欠落（参照先が無い）したら null を返す。
 * commit がスタッシュを親に取ってしまわないための繋ぎ直し先を求めるのに使う。
 */
function Ggit_firstNonStashAncestor_(store, id) {
  var cur = id;
  while (cur) {
    var o = store.objects[cur];
    if (!o) return null;       // 連鎖が壊れている（参照先欠落）
    if (!o.stash) return cur;  // 実コミットに到達
    cur = o.parent;
  }
  return null;
}

/** 指定コミットIDから親方向に辿ったコミット配列（フラットログ・status 用）。 */
function Ggit_logChain(store, startId) {
  var out = [];
  var id = startId || null;
  while (id) {
    var o = store.objects[id];
    if (!o) break;
    out.push(o);
    id = o.parent;
  }
  return out;
}

// ----- File: src/Diff.js -----
/**
 * Diff.js — テキスト差分表示。
 *
 * 設計仕様書 §7.1: diff-match-patch でタブ本文どうしの差分を算出し着色表示する。
 */

/** 2テキストの差分を着色HTML（diff_prettyHtml）で返す。 */
function Ggit_diffHtml(textA, textB) {
  var dmp = new diff_match_patch();
  var diffs = dmp.diff_main(textA, textB);
  dmp.diff_cleanupSemantic(diffs);
  return dmp.diff_prettyHtml(diffs);
}

/** 2コミット間の差分HTML（UIダイアログから google.script.run で呼ばれる）。 */
function Ggit_diffCommitsHtml(idA, idB) {
  var store = Ggit_storeLoad();
  // diff はプレーンテキスト対象（設計仕様書 §7.3）。スナップショットから text を射影する。
  var a = Ggit_plainOf(Ggit_materialize(store, idA));
  var b = Ggit_plainOf(Ggit_materialize(store, idB));
  return Ggit_diffHtml(a, b);
}

// ----- File: src/GC.js -----
/**
 * GC.js — 「掃除」: 繋がりのなくなったコミットの削除（ガベージコレクト）。
 *
 * 対象は Ggit_displayableIds の補集合、すなわち:
 *  - 孤立コミット: 現在地 @ / ブックマーク / スタッシュのどこからも辿れない。
 *  - 壊れたコミット: 親方向の連鎖が full に届かず本文を復元できない（例: 破棄された
 *    5653e7bf を親に持つ）。
 * いずれも DAG 上「繋がり」が切れており、クリックしても goto/diff が失敗するため掃除する。
 *
 * 安全策: 現在地 @ は壊れていても削除しない（内容は作業タブに生きており「修復」で立て直せる）。
 * 削除後は生存オブジェクトの欠落参照（parent/parent2）を根へ切り離し、消えたコミットを指す
 * ブックマークも取り除いて整合を保つ。
 */

/**
 * 繋がりのなくなったコミットを掃除する純粋関数（store を破壊的に更新）。保存は呼び出し側。
 * 戻り値: { removed:[id...], orphans, broken, workingBroken }。
 *  - orphans: 削除のうち孤立（到達不能）だった件数。
 *  - broken : 削除のうち壊れ（復元不能・到達可能）だった件数。
 *  - workingBroken: 掃除後も現在地 @ が壊れている（＝要修復）か。
 */
function Ggit_gcDisconnectedInStore(store) {
  var objects = store.objects || {};
  var working = store.working || null;
  var reachable = Ggit_reachableIds(store);
  var show = Ggit_displayableIds(store); // 表示対象＝残すもの（現在地 @ を含む）

  var removed = [], orphans = 0, broken = 0;
  for (var id in objects) {
    if (!objects.hasOwnProperty(id)) continue;
    if (show[id]) continue;             // 繋がっている（＝残す。現在地 @ もここで残る）
    removed.push(id);
    if (!reachable[id]) orphans++; else broken++;
  }
  for (var i = 0; i < removed.length; i++) delete objects[removed[i]];

  // 生存オブジェクトの欠落参照を根へ切り離し、消えたコミットを指すブックマークを除去する。
  Ggit_pruneDanglingRefs_(store);

  var workingBroken = !!(working && objects.hasOwnProperty(working) && !Ggit_canMaterialize(store, working));
  return { removed: removed, orphans: orphans, broken: broken, workingBroken: workingBroken };
}

/**
 * 「掃除」エントリポイント（log モーダルの掃除ボタン / メニューから呼ぶ）。
 * 繋がりのなくなったコミットを削除して `.vcs` を保存する。
 * 戻り値: { removed, orphans, broken, workingBroken }（removed は件数）。
 */
function Ggit_gcDisconnected() {
  var doc = DocumentApp.getActiveDocument();
  var store = Ggit_storeLoad(doc);
  var r = Ggit_gcDisconnectedInStore(store);
  if (r.removed.length) Ggit_storeSave(doc, store);
  return {
    removed: r.removed.length, orphans: r.orphans, broken: r.broken,
    workingBroken: r.workingBroken
  };
}

/** 繋がりのなくなったコミット件数（掃除ボタンのバッジ用）。{ total, orphans, broken } を返す。 */
function Ggit_countDisconnected(store) {
  var objects = store.objects || {};
  var reachable = Ggit_reachableIds(store);
  var show = Ggit_displayableIds(store);
  var orphans = 0, broken = 0;
  for (var id in objects) {
    if (!objects.hasOwnProperty(id) || show[id]) continue;
    if (!reachable[id]) orphans++; else broken++;
  }
  return { total: orphans + broken, orphans: orphans, broken: broken };
}

/**
 * 宙ぶらりんな参照を整える純粋関数（store を破壊的に更新）。掃除・破棄の後始末で共用する。
 *  - 生存オブジェクトが欠落 ID を parent/parent2 に指していたら根（null）へ切り離す。
 *  - 消えたコミットを指すブックマークを取り除く。
 */
function Ggit_pruneDanglingRefs_(store) {
  var objects = store.objects || {};
  for (var sid in objects) {
    if (!objects.hasOwnProperty(sid)) continue;
    var o = objects[sid];
    if (o.parent && !objects.hasOwnProperty(o.parent)) o.parent = null;
    if (o.parent2 && !objects.hasOwnProperty(o.parent2)) o.parent2 = null;
  }
  var bm = store.bookmarks || {};
  for (var name in bm) {
    if (bm.hasOwnProperty(name) && !objects.hasOwnProperty(bm[name])) delete bm[name];
  }
}

/** id を parent もしくは parent2 に持つ「非スタッシュ」コミット（＝実後続）が存在するか。 */
function Ggit_hasNonStashChild_(objects, id) {
  for (var cid in objects) {
    if (!objects.hasOwnProperty(cid)) continue;
    var c = objects[cid];
    if (c.stash) continue;
    if (c.parent === id || c.parent2 === id) return true;
  }
  return false;
}

/** id を parent もしくは parent2 に持つスタッシュ（仮コミット）の ID 一覧。 */
function Ggit_stashChildrenOf_(objects, id) {
  var out = [];
  for (var cid in objects) {
    if (!objects.hasOwnProperty(cid)) continue;
    var c = objects[cid];
    if (c.stash && (c.parent === id || c.parent2 === id)) out.push(cid);
  }
  return out;
}

/** id を指すブックマークが1つでもあるか。 */
function Ggit_isBookmarked_(store, id) {
  var bm = store.bookmarks || {};
  for (var name in bm) {
    if (bm.hasOwnProperty(name) && bm[name] === id) return true;
  }
  return false;
}

/**
 * 葉（可視ヘッド）コミットを破棄し、その枝だけを根方向へ刈る純粋関数（store を破壊的に更新）。
 * 戻り値: { removed:[id...], droppedStashes:[id...] }。保存は呼び出し側。
 *
 * 仕様:
 *  - 対象 id は「実後続（非スタッシュの子）を持たない葉」でなければならない（実枝があると壊すため）。
 *    スタッシュは「子」に数えず（可視ヘッド判定 Ggit_headIds と整合）、刈る枝に付随するスタッシュは
 *    一緒に破棄する。スタッシュ自体・現在地 @ は破棄不可。
 *  - id を消したのち親方向へ遡り、その祖先が「現在地 @ でも・ブックマーク先でも・実後続を持つ
 *    （他の実枝が乗る）でもない」間だけ続けて刈る。共有点（分岐元）で止まる。
 */
function Ggit_abandonInStore(store, id) {
  var objects = store.objects || {};
  var victim = objects[id];
  if (!victim) throw new Error('コミットが見つかりません: ' + id);
  if (victim.stash) {
    throw new Error('スタッシュは破棄できません。スタッシュ一覧の「破棄」を使ってください。');
  }
  if (store.working === id) {
    throw new Error('現在地 @ は破棄できません。先に別のコミットへ移動してください。');
  }
  if (Ggit_hasNonStashChild_(objects, id)) {
    throw new Error('このコミットには後続があります。枝の先端（葉）から破棄してください。');
  }

  var removed = [];
  var droppedStashes = [];
  var cur = id;
  while (cur) {
    var o = objects[cur];
    if (!o || o.stash) break;                          // スタッシュ側枝には入らない
    if (cur !== id) {
      if (store.working === cur) break;                // 現在地は刈らない
      if (Ggit_isBookmarked_(store, cur)) break;       // ブックマーク先は刈らない
      if (Ggit_hasNonStashChild_(objects, cur)) break; // 他の実枝が乗る共有点で止まる
    }
    // この枝に付随するスタッシュも一緒に破棄する（親を失って壊れるのを防ぐ）。
    var sids = Ggit_stashChildrenOf_(objects, cur);
    for (var si = 0; si < sids.length; si++) {
      delete objects[sids[si]];
      droppedStashes.push(sids[si]);
    }
    var parent = o.parent;
    delete objects[cur];
    removed.push(cur);
    cur = parent;
  }
  Ggit_pruneDanglingRefs_(store);
  return { removed: removed, droppedStashes: droppedStashes };
}

/**
 * 「破棄」エントリポイント（log モーダルのコミット行「破棄」から呼ぶ）。
 * 指定した葉コミットの枝を刈って `.vcs` を保存する（付随スタッシュも一緒に破棄）。
 * 戻り値: { removed, ids, droppedStashes }（removed・droppedStashes は件数）。
 */
function Ggit_abandonCommit(id) {
  var doc = DocumentApp.getActiveDocument();
  var store = Ggit_storeLoad(doc);
  var r = Ggit_abandonInStore(store, id);
  if (r.removed.length || r.droppedStashes.length) Ggit_storeSave(doc, store);
  return { removed: r.removed.length, ids: r.removed, droppedStashes: r.droppedStashes.length };
}

// ----- File: src/Graph.js -----
/**
 * Graph.js — コミットDAGの収集と ASCII レーングラフ描画（純粋関数）。
 *
 * 要望2「ブランチを意識した表示」に対応する。A→B→C で B に戻って B→D と分岐すると
 * 2つの匿名ヘッド（葉）ができる。これを git log --graph 風の縦レーンで可視化する。
 *
 * すべて純粋関数（GAS ランタイム非依存）なので SelfTest でユニット検証できる。
 * UI（Menu.js）は Ggit_collectNodes → Ggit_graphLines の結果を等幅フォントで描画する。
 */

/**
 * 「可視ヘッド」= 子を持たない非スタッシュコミットIDの集合 { id:true } を返す純粋関数。
 * jj の匿名ヘッド（visible heads）に相当する。commit はブックマークを動かさないため、コミット
 * 直後に @ を別の場所へ移すと直前コミットを指すものが無くなるが、それでも「葉」はここでヘッドとして
 * 拾われ、到達ルート（Ggit_reachableIds）に含めることで孤立させない。
 * スタッシュ（側枝）は子として数えない／ヘッドにもしない（スタッシュ自体は別ルートで保持）。
 */
function Ggit_headIds(store) {
  var objects = store.objects || {};
  var hasChild = {};
  for (var cid in objects) {
    if (!objects.hasOwnProperty(cid)) continue;
    var c = objects[cid];
    if (c.stash) continue; // スタッシュの親参照は「子を持つ」に数えない
    if (c.parent && objects.hasOwnProperty(c.parent)) hasChild[c.parent] = true;
    if (c.parent2 && objects.hasOwnProperty(c.parent2)) hasChild[c.parent2] = true;
  }
  var heads = {};
  for (var id in objects) {
    if (!objects.hasOwnProperty(id)) continue;
    if (objects[id].stash) continue;
    if (!hasChild[id]) heads[id] = true;
  }
  return heads;
}

/**
 * ルート（現在地 @ / ブックマーク / スタッシュ / 可視ヘッド）から parent・parent2 を辿って到達
 * できるオブジェクトIDの集合 { id:true } を返す純粋関数。到達できないものが「孤立コミット」。
 * 可視ヘッド（子を持たない非スタッシュコミット＝匿名ヘッド）も常にルートに含めるため、commit→
 * 移動でブックマーク無しの葉を置き去りにしても孤立しない（jj の visible heads 相当）。
 * スタッシュはそれ自体がルート（一覧から pop/破棄できるよう常に保持する）。
 * 参照先が欠落しているエッジは辿らない（存在するオブジェクトのみ集合へ入れる）。
 */
function Ggit_reachableIds(store) {
  var objects = store.objects || {};
  var bm = store.bookmarks || {};
  var seen = {};
  var stack = [];
  function pushRoot(id) {
    if (id && objects.hasOwnProperty(id) && !seen[id]) { seen[id] = true; stack.push(id); }
  }
  pushRoot(store.working || null);
  for (var name in bm) { if (bm.hasOwnProperty(name)) pushRoot(bm[name]); }
  for (var sid in objects) { if (objects.hasOwnProperty(sid) && objects[sid].stash) pushRoot(sid); }
  var heads = Ggit_headIds(store);
  for (var hid in heads) { if (heads.hasOwnProperty(hid)) pushRoot(hid); } // 匿名ヘッドを保持

  while (stack.length) {
    var o = objects[stack.pop()];
    if (!o) continue;
    pushRoot(o.parent);
    pushRoot(o.parent2);
  }
  return seen;
}

/**
 * log に表示する（＝「繋がっている」）オブジェクトIDの集合 { id:true } を返す純粋関数。
 * 表示条件: ルートから到達可能（reachable）かつ本文を復元可能（canMaterialize）。
 * 例外として現在地 @ は壊れていても常に表示する（ユーザーが自分の居場所を見失わず、
 * 「修復」へ誘導できるようにするため）。
 * ここに含まれないものが「繋がりのなくなったコミット」＝非表示かつ掃除（Ggit_gcDisconnected）対象。
 */
function Ggit_displayableIds(store) {
  var objects = store.objects || {};
  var working = store.working || null;
  var reachable = Ggit_reachableIds(store);
  var show = {};
  for (var id in objects) {
    if (!objects.hasOwnProperty(id)) continue;
    if (id === working) { show[id] = true; continue; }      // 現在地は壊れていても常に表示
    if (!reachable[id]) continue;                            // 孤立 → 非表示
    if (!Ggit_canMaterialize(store, id)) continue;          // 壊れ（復元不能）→ 非表示
    show[id] = true;
  }
  return show;
}

/**
 * store.objects のうち「繋がっている」ものだけを描画用ノード配列へ整形する。
 * 孤立コミット・壊れたコミットは Ggit_displayableIds で除外される（現在地 @ は除外しない）。
 * 子が親より前に来る順（おおむね新しい順）に並べる（レーン割当が前提とする向き）。
 * 各ノード: { id, parents:[...], refs:[名...], isWorking, isStash, isHead, hasStash, isBroken, message, timestamp, author }
 */
function Ggit_collectNodes(store) {
  var objects = store.objects || {};
  var working = store.working || null;
  var bm = store.bookmarks || {};
  var show = Ggit_displayableIds(store);
  var heads = Ggit_headIds(store); // 可視ヘッド（子を持たない非スタッシュコミット＝破棄可能な葉）

  // コミットID → そこを指すブックマーク名一覧
  var refsByCommit = {};
  for (var name in bm) {
    if (!bm.hasOwnProperty(name)) continue;
    var c = bm[name];
    (refsByCommit[c] = refsByCommit[c] || []).push(name);
  }

  // コミットID → そこに付随するスタッシュがあるか（破棄時に一緒に消える旨を UI で警告するため）
  var stashByParent = {};
  for (var sk in objects) {
    if (!objects.hasOwnProperty(sk)) continue;
    var so = objects[sk];
    if (!so.stash) continue;
    if (so.parent) stashByParent[so.parent] = true;
    if (so.parent2) stashByParent[so.parent2] = true;
  }

  var ids = [];
  for (var id in objects) { if (objects.hasOwnProperty(id) && show[id]) ids.push(id); }

  var nodes = {};
  ids.forEach(function (id) {
    var o = objects[id];
    // 親も表示対象のときだけエッジを引く（壊れた/孤立した親へは線を繋がない＝その場で根になる）。
    var parents = [];
    if (o.parent && show[o.parent]) parents.push(o.parent);
    if (o.parent2 && show[o.parent2]) parents.push(o.parent2);
    nodes[id] = {
      id: id,
      parents: parents,
      refs: refsByCommit[id] || [],
      isWorking: id === working,
      isStash: !!o.stash,
      isHead: !!heads[id],
      hasStash: !!stashByParent[id],
      isBroken: !Ggit_canMaterialize(store, id),
      message: o.message,
      timestamp: o.timestamp,
      author: o.author
    };
  });

  // 子を先に出す位相順（Kahn）。準備済み（未出力の子が無い）ノードを timestamp 降順で選ぶ。
  var childCount = {};
  ids.forEach(function (id) { childCount[id] = 0; });
  ids.forEach(function (id) {
    nodes[id].parents.forEach(function (p) {
      if (childCount[p] !== undefined) childCount[p]++;
    });
  });

  function newer(a, b) {
    var ta = nodes[a].timestamp || '', tb = nodes[b].timestamp || '';
    if (ta !== tb) return ta > tb;   // ISO8601 は辞書順＝時刻順
    return a > b;                    // タイブレークは id
  }

  var remaining = {};
  ids.forEach(function (id) { remaining[id] = true; });
  var out = [];
  for (var step = 0; step < ids.length; step++) {
    var best = null;
    for (var rid in remaining) {
      if (!remaining.hasOwnProperty(rid)) continue;
      if (childCount[rid] !== 0) continue;
      if (best === null || newer(rid, best)) best = rid;
    }
    if (best === null) {            // 循環など想定外。残りをそのまま追加して打ち切る。
      for (var k in remaining) { if (remaining.hasOwnProperty(k)) out.push(nodes[k]); }
      return out;
    }
    out.push(nodes[best]);
    delete remaining[best];
    nodes[best].parents.forEach(function (p) {
      if (childCount[p] !== undefined) childCount[p]--;
    });
  }
  return out;
}

/** col より右側で最初の空きレーンを返す。無ければ末尾に追加して返す。 */
function Ggit_graphEmptyAfter(lanes, col) {
  for (var i = col + 1; i < lanes.length; i++) {
    if (lanes[i] === null) return i;
  }
  lanes.push(null);
  return lanes.length - 1;
}

/**
 * レーン遷移の接続行（| / \ _）を生成する。
 *  - lanes: その時点のレーン状態（'|' の判定に使う）。
 *  - col:   基準カラム。collapse の集約先 / sprout の起点。
 *  - dups:  col へ collapse する余剰カラム（>col）。'/' で描く（呼び出し側で既に null 化済み）。
 *  - extras: col から sprout する追加カラム（>col, マージ第2親）。'\\' で描く。縦線は描かない。
 */
function Ggit_graphConnector(lanes, col, dups, extras) {
  var W = lanes.length;
  for (var d = 0; d < dups.length; d++) if (dups[d] + 1 > W) W = dups[d] + 1;
  for (var e = 0; e < extras.length; e++) if (extras[e] + 1 > W) W = extras[e] + 1;

  var len = W > 0 ? 2 * W - 1 : 1;
  var a = [];
  for (var i = 0; i < len; i++) a[i] = ' ';

  // 継続する縦レーン（sprout で今作った extras カラムには縦線を引かない）
  for (var c = 0; c < lanes.length; c++) {
    if (lanes[c] !== null && extras.indexOf(c) < 0) a[2 * c] = '|';
  }

  // 余剰の子レーンを col へ collapse: '/'（必要なら間を '_' で繋ぐ）
  for (var k = 0; k < dups.length; k++) {
    var j = dups[k];
    a[2 * j - 1] = '/';
    for (var x = 2 * col + 1; x < 2 * j - 1; x++) { if (a[x] === ' ') a[x] = '_'; }
  }

  // 追加の親へ sprout: '\\'（必要なら間を '_' で繋ぐ）
  for (var k2 = 0; k2 < extras.length; k2++) {
    var ex = extras[k2];
    a[2 * col + 1] = '\\';
    for (var x2 = 2 * col + 2; x2 < 2 * ex; x2++) { if (a[x2] === ' ') a[x2] = '_'; }
  }

  return a.join('');
}

/**
 * ノード配列（Ggit_collectNodes の出力＝子が先）から ASCII レーングラフの行を生成する。
 * 返り値: [{ graph:'<等幅プレフィックス>', id:'<commitId>'|null, node:<node>|null }]
 *  - id 付きの行が commit 行（クリック対象）。id=null は接続行。
 *  - graph 文字列は 2*col 位置に各レーンの記号（'*' commit / '|' 縦 / 接続記号）を置く。
 */
function Ggit_graphLines(nodes) {
  var lanes = [];      // 各カラムが「次に描く commitId」（無ければ null）
  var rows = [];

  function firstLaneOf(id) {
    for (var i = 0; i < lanes.length; i++) if (lanes[i] === id) return i;
    return -1;
  }
  function firstEmpty() {
    for (var i = 0; i < lanes.length; i++) if (lanes[i] === null) return i;
    return -1;
  }

  for (var n = 0; n < nodes.length; n++) {
    var node = nodes[n];
    var id = node.id;
    var parents = node.parents || [];

    // この commit のカラム
    var col = firstLaneOf(id);
    if (col === -1) {
      col = firstEmpty();
      if (col === -1) { col = lanes.length; lanes.push(null); }
      lanes[col] = id;
    }

    // 複数の子が同じ親（この commit）へ合流＝余剰レーンを col へ collapse。
    // collapse は commit 行の「上」に描く（合流先コミットの直前で枝が閉じる）。
    var dups = [];
    for (var j = 0; j < lanes.length; j++) {
      if (j !== col && lanes[j] === id) dups.push(j);
    }
    if (dups.length) {
      for (var dd = 0; dd < dups.length; dd++) lanes[dups[dd]] = null; // 先に null 化
      rows.push({ graph: Ggit_graphConnector(lanes, col, dups, []), id: null, node: null });
    }

    // commit 行（col に '*'、他の非null レーンに '|'）
    var cells = [];
    for (var i = 0; i < lanes.length; i++) {
      cells.push(lanes[i] === null ? ' ' : (i === col ? '*' : '|'));
    }
    rows.push({ graph: cells.join(' '), id: id, node: node });

    // 前進: col→第1親、追加の親（マージ）→col の右の空きレーンへ sprout（commit 行の「下」）。
    var p0 = parents.length > 0 ? parents[0] : null;
    lanes[col] = p0;
    var extras = [];
    for (var pi = 1; pi < parents.length; pi++) {
      var ec = Ggit_graphEmptyAfter(lanes, col);
      lanes[ec] = parents[pi];
      extras.push(ec);
    }
    if (extras.length) {
      rows.push({ graph: Ggit_graphConnector(lanes, col, [], extras), id: null, node: null });
    }

    // 末尾の空きレーンを刈る
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
  }

  return rows;
}

// ----- File: src/Hash.js -----
/**
 * Hash.js — コミットID（SHA-256 短縮ハッシュ）。
 *
 * 設計仕様書 §5.1: 本文シリアライズの SHA-256 を短縮してコミットIDとする。
 */

/** 文字列の SHA-256 を小文字 hex で返す。 */
function Ggit_sha256Hex(input) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256; // byte は符号付きのため 0..255 に正規化
    var h = b.toString(16);
    hex += (h.length === 1 ? '0' : '') + h;
  }
  return hex;
}

/**
 * コミットIDを算出する。既存IDと衝突する短縮形は桁を伸ばして一意化する。
 * 入力は parent / timestamp / 本文全文を連結したもの。
 * （jjモデルではコミットにブランチ所有概念が無いため、ハッシュ入力から branch を外した。）
 */
function Ggit_commitId(store, parent, timestamp, fullText) {
  var hex = Ggit_sha256Hex((parent || '') + '\n' + timestamp + '\n' + fullText);
  for (var len = 7; len < hex.length; len++) {
    var cand = hex.substring(0, len);
    if (!store.objects[cand]) return cand;
  }
  return hex;
}

// ----- File: src/Menu.js -----
/**
 * Menu.js — onOpen カスタムメニューと UI ハンドラ。
 *
 * Jujutsu 流モデル: commit は現在地 working（@）を前進させ、ブックマークは手動で設定/移動する。
 * Log はブランチ（分岐）を意識した ASCII レーングラフで表示し、フラット表示にも切替できる。
 * スタッシュは objects 内の仮コミット（stash:true）として一覧し、pop（戻して消す）/ drop できる。
 * Log（グラフ）画面を操作ハブとし、行を選択して diff / merge / bookmark / 移動(goto) を実行できる
 * （diff/merge/bookmark/goto のメニュー項目は廃止し、すべて Log（グラフ）画面に統合した）。
 */

/**
 * ドキュメントを開いたときにカスタムメニューを生成する（単純トリガ）。
 *
 * diff / bookmark / merge は「Log（グラフ）」画面に統合したため、メニューには出さない
 * （要望: ログ画面で bookmark の閲覧・編集・diff の閲覧・merge・移動まで完結する）。
 */
function onOpen() {
  DocumentApp.getUi()
    .createMenu('ggit')
    .addItem('初期化（権限付与・.vcs作成）', 'ggitUI_setup')
    .addSeparator()
    .addItem('Commit…', 'ggitUI_commit')
    .addItem('Log（グラフ・操作ハブ）', 'ggitUI_log')
    .addItem('ステータス', 'ggitUI_status')
    .addSeparator()
    .addItem('修復（壊れた履歴の復旧）', 'ggitUI_repair')
    .addItem('整合性チェック / 復旧', 'ggitUI_reconcile')
    .addItem('圧縮 / 清書 (Compact)', 'ggitUI_compact')
    .addItem('About', 'ggitUI_about')
    .addToUi();
}

/**
 * 初期化済み（`.vcs` あり）でなければ、案内を出して false を返す共通ガード。
 *
 * メニュー項目は onOpen（AuthMode.NONE）で静的に作られ状態で出し分けできないため、各操作の
 * 入口でこれを呼ぶ。`.vcs` 未作成のうちに commit 等が中途半端に動いて「できている」と
 * 誤解させないよう、まず「初期化（権限付与・.vcs作成）」へ誘導する。
 */
function Ggit_uiRequireInit_(ui) {
  if (Ggit_isInitialized(DocumentApp.getActiveDocument())) return true;
  ui.alert('ggit',
    'まだ初期化されていません。\n' +
    'メニューの「初期化（権限付与・.vcs作成）」を先に実行してください。',
    ui.ButtonSet.OK);
  return false;
}

/* ===================== 共通ユーティリティ ===================== */

function Ggit_esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function Ggit_showModal(htmlStr, title, w, h) {
  var out = HtmlService.createHtmlOutput(htmlStr).setWidth(w).setHeight(h);
  DocumentApp.getUi().showModalDialog(out, title);
}

/* ===================== UI から呼ばれるサーバ補助 ===================== */

/**
 * 1ノードを UI 向けに簡約する。
 * parent は「直線表示（クリック地点→ルート）」をクライアント側で辿るための第1親
 * （表示対象の親のみ。表示対象外＝壊れ/孤立の親は collectNodes 段階で落ちているので null）。
 */
function Ggit_uiNode(node) {
  return {
    id: node.id, message: node.message, timestamp: node.timestamp, author: node.author,
    refs: node.refs || [], isWorking: !!node.isWorking, isStash: !!node.isStash,
    isHead: !!node.isHead, hasStash: !!node.hasStash, isBroken: !!node.isBroken,
    parent: (node.parents && node.parents.length) ? node.parents[0] : null
  };
}

/** Log モーダル用データ: グラフ行・フラット列・現在地・ブックマーク・スタッシュ。 */
function Ggit_uiGraphData() {
  var doc = DocumentApp.getActiveDocument();
  var store = Ggit_storeLoad(doc);
  var nodes = Ggit_collectNodes(store);

  var rows = Ggit_graphLines(nodes).map(function (r) {
    return { graph: r.graph, id: r.id, c: r.node ? Ggit_uiNode(r.node) : null };
  });
  var flat = nodes.map(Ggit_uiNode);
  var bookmarks = [];
  for (var name in store.bookmarks) {
    if (store.bookmarks.hasOwnProperty(name)) bookmarks.push({ name: name, commitId: store.bookmarks[name] });
  }
  var disconnected = Ggit_countDisconnected(store); // 非表示にした孤立／壊れコミットの件数
  var working = store.working || null;
  var workingBroken = !!(working && store.objects.hasOwnProperty(working) &&
    !Ggit_canMaterialize(store, working));
  return {
    rows: rows, flat: flat, working: working,
    bookmarks: bookmarks, stashes: Ggit_listStashes(store),
    disconnected: disconnected, workingBroken: workingBroken
  };
}

/** goto のセレクタ用: ブックマーク＋コミット＋現在地。 */
function Ggit_uiListRefs() {
  var doc = DocumentApp.getActiveDocument();
  var store = Ggit_storeLoad(doc);
  var bookmarks = [];
  for (var name in store.bookmarks) {
    if (store.bookmarks.hasOwnProperty(name)) bookmarks.push({ name: name, commitId: store.bookmarks[name] });
  }
  var commits = Ggit_collectNodes(store)
    .filter(function (n) { return !n.isStash; })
    .map(Ggit_uiNode);
  return { bookmarks: bookmarks, commits: commits, working: store.working || null };
}

/* ===================== メニューハンドラ ===================== */

function ggitUI_setup() {
  var ui = DocumentApp.getUi();
  try {
    var info = Ggit_setup();
    var note = '\n\n※ バックアップ（PropertiesService）はバックグラウンドで非同期に走り、' +
      '反映まで数十秒かかることがあります（次の操作が自動で先に完了させます）。\n' +
      '※ トリガ作成の権限が増えたため、再度の権限承認が求められることがあります。';
    ui.alert('ggit 初期化',
      (info.created
        ? ('初期化が完了しました。\n' +
           '「.vcs」を作成しました（ドキュメント: ' + info.title + '）。\n' +
           'これで Commit などが使えます。')
        : '既に初期化済みです（「.vcs」あり）。Commit などがそのまま使えます。') + note,
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('ggit 初期化', '初期化中にエラー: ' + e.message, ui.ButtonSet.OK);
  }
}

/**
 * Commit ダイアログ。
 *
 * ネイティブの ui.prompt は Enter での確定が効かないため、テキスト入力に Enter キーで
 * コミットできる独自モーダルにする（要望: コミット時に Enter だけで確定）。
 * 成功メッセージは簡潔に（要望: 「ブックマークは動きません」の案内は不要）。
 */
function ggitUI_commit() {
  var ui = DocumentApp.getUi();
  if (!Ggit_uiRequireInit_(ui)) return;
  var html =
    '<div style="font:13px/1.5 Roboto,Arial,sans-serif;padding:6px">' +
    '<p style="margin:0 0 6px">コミットメッセージを入力してください（<b>Enter</b> でコミット）:</p>' +
    '<input id="msg" type="text" style="width:100%;box-sizing:border-box" />' +
    '<div style="margin-top:8px">' +
    '<button id="ok">コミット</button> ' +
    '<button id="cancel">キャンセル</button></div>' +
    '<div id="out" style="margin-top:8px;min-height:18px"></div>' +
    '<script>' +
    'function el(id){return document.getElementById(id);}' +
    'function run(){var msg=(el("msg").value||"").trim();' +
    'if(!msg){el("out").style.color="#d93025";el("out").textContent="メッセージが空です。";el("msg").focus();return;}' +
    'el("ok").disabled=true;el("out").style.color="#188038";el("out").textContent="コミット中…";' +
    'google.script.run.withSuccessHandler(function(id){' +
    'el("out").textContent="コミットしました: "+id;' +
    'setTimeout(function(){google.script.host.close();},800);})' +
    '.withFailureHandler(function(e){el("ok").disabled=false;el("out").style.color="#d93025";el("out").textContent=e.message;el("msg").focus();})' +
    '.Ggit_commit(msg);}' +
    'el("ok").addEventListener("click",run);' +
    'el("cancel").addEventListener("click",function(){google.script.host.close();});' +
    'el("msg").addEventListener("keydown",function(e){if(e.keyCode===13){e.preventDefault();run();}});' +
    'el("msg").focus();' +
    '</script></div>';
  Ggit_showModal(html, 'ggit commit', 460, 200);
}

/**
 * Log（グラフ）= 操作ハブ。
 *
 * 行クリックでコミットを「選択」（ハイライト）し、下部の操作パネルから 移動(goto) / マージ /
 * ブックマーク設定・削除 / diff を実行する。選択コミットは「直線表示（クリック地点→ルート）」の
 * 起点にもなる。データ取得・各操作はすべてクライアントから google.script.run でサーバ関数を呼ぶ
 * （commit/goto/merge/bookmark/diff/stash/gc のロジックは既存実装を再利用）。
 *
 * 行・チップ生成は DOM API（createElement/textContent/dataset）で行い、HTML 文字列の
 * クォートエスケープを避ける。イベントは委譲（addEventListener）で受ける。
 */
function ggitUI_log() {
  var ui = DocumentApp.getUi();
  if (!Ggit_uiRequireInit_(ui)) return;

  var style =
    '<style>' +
    '.gg{font:13px/1.5 Roboto,Arial,sans-serif;padding:4px}' +
    '.gg .hdr{padding:6px 8px;background:#f8f9fa;border:1px solid #e0e0e0;border-radius:4px;margin-bottom:6px}' +
    '.gg .broken{color:#d93025;margin-bottom:6px}' +
    '.gg .bar{margin-bottom:4px}' +
    '.gg .bar .lin{margin-left:12px}' +
    '.gg .gc{margin-left:12px;color:#b06000}' +
    '.gg .status{min-height:18px;color:#188038;margin-bottom:6px}' +
    '.gg .help{color:#888;margin-bottom:4px}' +
    '.gg table{border-collapse:collapse;width:100%}' +
    '.gg td{padding:1px 2px;vertical-align:top}' +
    '.gg .row{cursor:pointer}' +
    '.gg .row:hover{background:#f1f3f4}' +
    '.gg .row.sel{background:#d2e3fc}' +
    '.gg .row.sel:hover{background:#d2e3fc}' +
    '.gg .g{font-family:monospace;white-space:pre;color:#444}' +
    '.gg .hash{font-family:monospace;color:#1a73e8}' +
    '.gg .at{color:#188038;font-weight:bold}' +
    '.gg .chip{background:#e8f0fe;color:#1a73e8;border-radius:3px;padding:0 4px;margin:0 1px}' +
    '.gg .stash{color:#b06000}' +
    '.gg .brk{color:#d93025;font-weight:bold}' +
    '.gg .author{color:#188038}' +
    '.gg .time{color:#aaa}' +
    '.gg .warn{color:#b06000}' +
    '.gg .panel{margin-top:14px;border-top:2px solid #e0e0e0;padding-top:8px}' +
    '.gg .ph{font-weight:bold;margin-bottom:6px}' +
    '.gg .selinfo{font-weight:normal;color:#555;margin-left:6px}' +
    '.gg .pr{margin-bottom:8px}' +
    '.gg .lbl{color:#555;margin-right:4px}' +
    '.gg .bmlist{margin-left:8px}' +
    '.gg .diffout{border:1px solid #ddd;padding:8px;min-height:60px;max-height:240px;white-space:pre-wrap;font-family:monospace;overflow:auto;margin-top:6px}' +
    '</style>';

  var body =
    '<div id="header" class="hdr">読み込み中…</div>' +
    '<div id="broken" class="broken"></div>' +
    '<div class="bar">' +
    '<button id="bGraph">グラフ</button> ' +
    '<button id="bFlat">フラット</button>' +
    '<label class="lin"><input type="checkbox" id="linear"> 直線表示（選択地点→ルートだけ）</label>' +
    '<button id="bGc" class="gc" style="display:none"></button>' +
    '</div>' +
    '<div id="status" class="status"></div>' +
    '<div class="help">' +
    '行をクリックするとそのコミットを<b>選択</b>します（下の操作と「直線表示」の対象になります）。' +
    'スタッシュ行は選択対象外です（下の一覧で「戻す(pop)」/「破棄」）。' +
    'コミットは @ を移しても消えません（匿名ヘッドとして残る）。不要な枝は葉の「破棄」で削除、' +
    '復元できない壊れたコミットは非表示で「掃除」で削除できます。' +
    '<code>&lt;name&gt;</code>=ブックマーク, <code>@</code>=現在地, <code>[stash]</code>=スタッシュ。</div>' +
    '<div id="list" class="list">読み込み中…</div>' +
    '<div id="stashes"></div>' +
    '<div class="panel">' +
    '<div class="ph">操作 <span id="selInfo" class="selinfo"></span></div>' +
    '<div class="pr">' +
    '<button id="opGoto">移動(goto)</button> ' +
    '<button id="opMerge">＠へマージ</button></div>' +
    '<div class="pr"><span class="lbl">bookmark:</span>' +
    '<input id="bmName" type="text" placeholder="main など" /> ' +
    '<button id="opBmSet">設定</button>' +
    '<span id="bmList" class="bmlist"></span></div>' +
    '<div class="pr"><span class="lbl">diff:</span>' +
    'A <input id="dFilterA" type="text" placeholder="A絞り込み（ID・メッセージ）" style="width:150px" /> <select id="dA"></select> ' +
    'B <input id="dFilterB" type="text" placeholder="B絞り込み（ID・メッセージ）" style="width:150px" /> <select id="dB"></select> ' +
    '<button id="opDiff">差分表示</button></div>' +
    '<div id="diffOut" class="diffout"></div>' +
    '</div>';

  var script =
    '<script>' +
    'var DATA=null,VIEW="graph",LINEAR=false,SEL=null;' +
    'function el(id){return document.getElementById(id);}' +
    'function setStatus(m,err){var d=el("status");d.style.color=err?"#d93025":"#188038";d.textContent=m||"";}' +
    'function onErr(e){setStatus(e.message||String(e),true);}' +
    'function fmtTime(ts){if(!ts)return "";var s=String(ts).replace("T"," ");' +
    'if(s.charAt(s.length-1)==="Z")return s.substring(0,s.length-1);' +
    'var c=s.charAt(s.length-6);' +
    'if((c==="+"||c==="-")&&s.charAt(s.length-3)===":")return s.substring(0,s.length-6);' +
    'return s;}' +
    'function nodeMap(){var m={};if(DATA&&DATA.flat){for(var i=0;i<DATA.flat.length;i++)m[DATA.flat[i].id]=DATA.flat[i];}return m;}' +
    'function chain(start){var m=nodeMap(),out=[],id=start,g=0;while(id&&m[id]&&g<100000){out.push(m[id]);id=m[id].parent;g++;}return out;}' +
    'function commitList(){var out=[];if(DATA&&DATA.flat){for(var i=0;i<DATA.flat.length;i++){if(!DATA.flat[i].isStash)out.push(DATA.flat[i]);}}return out;}' +
    'function span(cls,txt){var s=document.createElement("span");if(cls)s.className=cls;s.textContent=txt;return s;}' +
    'function txt(t){return document.createTextNode(t);}' +
    'function appendRefs(td,c){var i;if(c.refs){for(i=0;i<c.refs.length;i++){td.appendChild(txt(" "));td.appendChild(span("chip",c.refs[i]));}}' +
    'if(c.isWorking){td.appendChild(txt(" "));td.appendChild(span("at","@"));}' +
    'if(c.isStash){td.appendChild(txt(" "));td.appendChild(span("stash","[stash]"));}' +
    'if(c.isBroken){td.appendChild(txt(" "));td.appendChild(span("brk","[壊れ]"));}}' +
    'function fillCell(td,c){td.appendChild(span("hash",c.id));appendRefs(td,c);' +
    'td.appendChild(txt("  "+(c.message||"")+"  "));' +
    'td.appendChild(span("author",c.author||""));td.appendChild(txt("  "));' +
    'td.appendChild(span("time",fmtTime(c.timestamp)));' +
    'if(c.isHead&&!c.isWorking&&!c.isStash){td.appendChild(txt(" "));' +
    'var b=document.createElement("button");b.className="warn";b.textContent="破棄";b.title="この葉コミットの枝を破棄";' +
    'b.setAttribute("data-act","abandon");b.setAttribute("data-id",c.id);b.setAttribute("data-hasstash",c.hasStash?"1":"0");' +
    'td.appendChild(b);}}' +
    'function makeRow(c,graph){var tr=document.createElement("tr");' +
    'if(graph!=null){var g=document.createElement("td");g.className="g";g.textContent=graph;tr.appendChild(g);}' +
    'if(c){if(!c.isStash){tr.className="row"+(c.id===SEL?" sel":"");tr.setAttribute("data-id",c.id);}' +
    'var td=document.createElement("td");fillCell(td,c);tr.appendChild(td);}' +
    'else{tr.appendChild(document.createElement("td"));}return tr;}' +
    'function helpDiv(t){var d=document.createElement("div");d.className="help";d.textContent=t;return d;}' +
    'function renderList(){var host=el("list");host.innerHTML="";if(!DATA){host.textContent="読み込み中…";return;}' +
    'var table=document.createElement("table"),i;' +
    'if(LINEAR){var start=SEL||DATA.working;' +
    'if(!start){host.appendChild(helpDiv("直線表示の起点がありません（行を選択するか、Commit で現在地 @ を作成してください）。"));return;}' +
    'var ch=chain(start);if(!ch.length){host.appendChild(helpDiv("表示できるコミットがありません。"));return;}' +
    'for(i=0;i<ch.length;i++)table.appendChild(makeRow(ch[i],null));host.appendChild(table);return;}' +
    'if(VIEW==="graph"){var rows=DATA.rows||[];if(!rows.length){host.appendChild(helpDiv("コミットがありません。"));return;}' +
    'for(i=0;i<rows.length;i++)table.appendChild(makeRow(rows[i].c,rows[i].graph));}' +
    'else{var f=DATA.flat||[];if(!f.length){host.appendChild(helpDiv("コミットがありません。"));return;}' +
    'for(i=0;i<f.length;i++)table.appendChild(makeRow(f[i],null));}' +
    'host.appendChild(table);}' +
    'function renderHeader(){var host=el("header");host.innerHTML="";if(!DATA)return;' +
    'if(!DATA.working){host.appendChild(span("help","(現在地なし — Commit でコミットを作成してください)"));return;}' +
    'host.appendChild(span("at","現在地 @ "));host.appendChild(span("hash",DATA.working));' +
    'var wn=nodeMap()[DATA.working]||null;if(wn&&wn.refs){for(var i=0;i<wn.refs.length;i++){host.appendChild(txt(" "));host.appendChild(span("chip",wn.refs[i]));}}}' +
    'function renderBookmarks(){var host=el("bmList");host.innerHTML="";' +
    'if(!DATA||!DATA.bookmarks||!DATA.bookmarks.length){host.appendChild(span("help","（ブックマークなし）"));return;}' +
    'for(var i=0;i<DATA.bookmarks.length;i++){var b=DATA.bookmarks[i];' +
    'host.appendChild(span("chip",b.name));host.appendChild(txt(" "));' +
    'host.appendChild(span("time","@"+b.commitId));host.appendChild(txt(" "));' +
    'var del=document.createElement("button");del.textContent="削除";del.setAttribute("data-act","bmdel");del.setAttribute("data-name",b.name);' +
    'host.appendChild(del);host.appendChild(txt("  "));}}' +
    'function renderStashes(){var host=el("stashes");host.innerHTML="";if(!DATA||!DATA.stashes||!DATA.stashes.length)return;' +
    'var title=document.createElement("div");title.className="ph";title.style.marginTop="14px";title.textContent="スタッシュ（仮コミット）";host.appendChild(title);' +
    'var table=document.createElement("table");' +
    'for(var i=0;i<DATA.stashes.length;i++){var o=DATA.stashes[i];var tr=document.createElement("tr");' +
    'var t1=document.createElement("td");t1.className="hash";t1.textContent=o.id;tr.appendChild(t1);' +
    'var t2=document.createElement("td");t2.textContent="  "+(o.message||"")+"  ";tr.appendChild(t2);' +
    'var t3=document.createElement("td");t3.className="time";t3.textContent=fmtTime(o.timestamp);tr.appendChild(t3);' +
    'var t4=document.createElement("td");' +
    'var pop=document.createElement("button");pop.textContent="戻す(pop)";pop.setAttribute("data-act","pop");pop.setAttribute("data-id",o.id);t4.appendChild(pop);' +
    't4.appendChild(txt(" "));' +
    'var drp=document.createElement("button");drp.textContent="破棄";drp.setAttribute("data-act","drop");drp.setAttribute("data-id",o.id);t4.appendChild(drp);' +
    'tr.appendChild(t4);table.appendChild(tr);}host.appendChild(table);}' +
    'function diffFilterText(id){var f=el(id);return f?(f.value||"").trim().toLowerCase():"";}' +
    'function diffMatch(c,q){if(!q)return true;return ((c.id||"").toLowerCase().indexOf(q)>=0)||((c.message||"").toLowerCase().indexOf(q)>=0);}' +
    'function fillSelect(sel,chosen,filterId){var q=diffFilterText(filterId);sel.innerHTML="";var list=commitList();for(var i=0;i<list.length;i++){var c=list[i];' +
    'if(!diffMatch(c,q))continue;' +
    'var op=document.createElement("option");op.value=c.id;op.textContent=c.id+" — "+(c.message||"");if(c.id===chosen)op.selected=true;sel.appendChild(op);}}' +
    'function refillDiffA(){fillSelect(el("dA"),el("dA").value,"dFilterA");}' +
    'function refillDiffB(){fillSelect(el("dB"),el("dB").value,"dFilterB");}' +
    'function selParent(){var n=SEL?nodeMap()[SEL]:null;return n?n.parent:null;}' +
    'function diffDefB(){return SEL||(DATA&&DATA.working)||(commitList()[0]&&commitList()[0].id)||"";}' +
    'function diffDefA(){return selParent()||diffDefB();}' +
    'function renderDiffSelectors(){fillSelect(el("dA"),diffDefA(),"dFilterA");fillSelect(el("dB"),diffDefB(),"dFilterB");}' +
    'function renderPanelSel(){el("selInfo").textContent=SEL?("選択: "+SEL):"（行をクリックして選択）";' +
    'if(el("dA"))el("dA").value=diffDefA();if(el("dB"))el("dB").value=diffDefB();' +
    'var has=!!SEL;el("opGoto").disabled=!has;el("opMerge").disabled=!has;el("opBmSet").disabled=!has;}' +
    'function renderToolbar(){var dc=(DATA&&DATA.disconnected)||{total:0,orphans:0,broken:0};var gb=el("bGc");' +
    'if(dc.total>0){gb.style.display="";gb.textContent="掃除 ("+dc.total+")";gb.title="繋がりのなくなったコミット "+dc.total+" 件（孤立 "+dc.orphans+" / 壊れ "+dc.broken+"）を削除";}else{gb.style.display="none";}' +
    'el("broken").textContent=(DATA&&DATA.workingBroken)?"現在地 @ の内容を復元できません（壊れています）。メニューの「修復」で立て直してください。":"";' +
    'el("bGraph").disabled=(VIEW==="graph")||LINEAR;el("bFlat").disabled=(VIEW==="flat")||LINEAR;el("linear").checked=LINEAR;}' +
    'function renderAll(){renderHeader();renderToolbar();renderBookmarks();renderStashes();renderDiffSelectors();renderList();renderPanelSel();}' +
    'function refresh(){google.script.run.withSuccessHandler(function(d){DATA=d;if(SEL&&!nodeMap()[SEL])SEL=null;renderAll();}).withFailureHandler(onErr).Ggit_uiGraphData();}' +
    'function selectCommit(id){SEL=(SEL===id)?null:id;renderList();renderPanelSel();}' +
    'function setView(v){if(LINEAR)return;VIEW=v;renderToolbar();renderList();}' +
    'function toggleLinear(){LINEAR=el("linear").checked;renderToolbar();renderList();}' +
    'function goTo(){if(!SEL){setStatus("行をクリックしてコミットを選択してください",true);return;}' +
    'if(!confirm("現在地 @ を "+SEL+" へ移動します。\\n現在の未コミット内容はスタッシュに退避されます。よろしいですか？"))return;' +
    'setStatus("移動中…");google.script.run.withSuccessHandler(function(r){setStatus("移動しました: "+r.commitId+(r.stashed?"（未コミット内容をスタッシュに退避）":""));refresh();}).withFailureHandler(onErr).Ggit_goto(SEL);}' +
    'function mergeInto(){if(!SEL){setStatus("行をクリックしてマージ元を選択してください",true);return;}' +
    'if(!confirm("選択コミット "+SEL+" を現在地 @ へ 3-way マージします。よろしいですか？"))return;' +
    'setStatus("マージ中…");google.script.run.withSuccessHandler(function(r){var m;' +
    'if(r.upToDate){m="既に取り込み済みです（変更なし）。";}' +
    'else if(r.fastForward){m="早送り（fast-forward）で取り込みました。"+(r.stashed?"（未コミット内容をスタッシュに退避）":"");}' +
    'else if(r.conflict){m="競合が発生しました。本文に <<<<<<< / ======= / >>>>>>> マーカーを書き戻しました。手動で解決後、commit してください。";}' +
    'else{m="クリーンにマージしました。マージコミット: "+r.commitId;}setStatus(m);refresh();}).withFailureHandler(onErr).Ggit_merge(SEL);}' +
    'function bmSet(){var n=el("bmName").value.trim();if(!n){setStatus("ブックマーク名を入力してください",true);return;}if(!SEL){setStatus("対象コミットを行から選択してください",true);return;}' +
    'google.script.run.withSuccessHandler(function(r){setStatus("ブックマーク「"+r.name+"」を "+r.commitId+" に設定しました。");el("bmName").value="";refresh();}).withFailureHandler(onErr).Ggit_bookmarkSet(n,SEL);}' +
    'function bmDelete(n){if(!confirm("ブックマーク「"+n+"」を削除します。よろしいですか？"))return;' +
    'google.script.run.withSuccessHandler(function(r){setStatus("ブックマーク「"+r.name+"」を削除しました。");refresh();}).withFailureHandler(onErr).Ggit_bookmarkDelete(n);}' +
    'function runDiff(){var a=el("dA").value,b=el("dB").value;if(!a||!b){setStatus("差分対象を選んでください",true);return;}' +
    'var o=el("diffOut");o.textContent="計算中…";google.script.run.withSuccessHandler(function(h){o.innerHTML=h;}).withFailureHandler(function(e){o.textContent=e.message;}).Ggit_diffCommitsHtml(a,b);}' +
    'function popStash(id){if(!confirm("スタッシュ "+id+" の内容を現在のタブに戻し、このスタッシュを消します。よろしいですか？"))return;' +
    'setStatus("適用中…");google.script.run.withSuccessHandler(function(r){setStatus("スタッシュを戻して消しました"+(r.stashed?"（直前の内容を退避）":""));refresh();}).withFailureHandler(onErr).Ggit_popStash(id);}' +
    'function dropStash(id){if(!confirm("スタッシュ "+id+" を破棄します。元に戻せません。よろしいですか？"))return;' +
    'google.script.run.withSuccessHandler(function(){setStatus("スタッシュを破棄しました");refresh();}).withFailureHandler(onErr).Ggit_dropStash(id);}' +
    'function abandon(id,hasStash){var m=hasStash?("コミット "+id+" には未コミット内容のスタッシュが付いています。\\n枝を破棄すると、その付随スタッシュも一緒に破棄されます（元に戻せません）。よろしいですか？"):("コミット "+id+" の枝を破棄します（葉から分岐元まで遡って削除）。\\n現在地 @ ・ブックマーク先・他の枝が乗る地点は残します。元に戻せません。よろしいですか？");if(!confirm(m))return;' +
    'setStatus("破棄中…");google.script.run.withSuccessHandler(function(r){setStatus("破棄しました: "+r.removed+" 件削除"+(r.droppedStashes?("（スタッシュ "+r.droppedStashes+" 件も破棄）"):""));refresh();}).withFailureHandler(onErr).Ggit_abandonCommit(id);}' +
    'function gc(){var dc=(DATA&&DATA.disconnected)||{total:0,orphans:0,broken:0};if(!dc.total)return;' +
    'if(!confirm("繋がりのなくなったコミット "+dc.total+" 件（孤立 "+dc.orphans+" / 壊れ "+dc.broken+"）を削除します。\\n現在地 @ は残します。元に戻せません。よろしいですか？"))return;' +
    'setStatus("掃除中…");google.script.run.withSuccessHandler(function(r){setStatus("掃除しました: "+r.removed+" 件削除（孤立 "+r.orphans+" / 壊れ "+r.broken+"）"+(r.workingBroken?" ※現在地 @ が壊れています。修復してください。":""));refresh();}).withFailureHandler(onErr).Ggit_gcDisconnected();}' +
    'el("bGraph").addEventListener("click",function(){setView("graph");});' +
    'el("bFlat").addEventListener("click",function(){setView("flat");});' +
    'el("linear").addEventListener("change",toggleLinear);' +
    'el("bGc").addEventListener("click",gc);' +
    'el("opGoto").addEventListener("click",goTo);' +
    'el("opMerge").addEventListener("click",mergeInto);' +
    'el("opBmSet").addEventListener("click",bmSet);' +
    'el("opDiff").addEventListener("click",runDiff);' +
    'el("dFilterA").addEventListener("input",refillDiffA);' +
    'el("dFilterB").addEventListener("input",refillDiffB);' +
    'el("list").addEventListener("click",function(e){var b=e.target.closest("button[data-act]");' +
    'if(b){if(b.getAttribute("data-act")==="abandon")abandon(b.getAttribute("data-id"),b.getAttribute("data-hasstash")==="1");return;}' +
    'var row=e.target.closest("tr[data-id]");if(row)selectCommit(row.getAttribute("data-id"));});' +
    'el("stashes").addEventListener("click",function(e){var b=e.target.closest("button[data-act]");if(!b)return;' +
    'var a=b.getAttribute("data-act");if(a==="pop")popStash(b.getAttribute("data-id"));else if(a==="drop")dropStash(b.getAttribute("data-id"));});' +
    'el("bmList").addEventListener("click",function(e){var b=e.target.closest("button[data-act]");if(b&&b.getAttribute("data-act")==="bmdel")bmDelete(b.getAttribute("data-name"));});' +
    'refresh();' +
    '</script>';

  Ggit_showModal('<div class="gg">' + style + body + script + '</div>', 'ggit log（操作ハブ）', 780, 680);
}

function ggitUI_goto() {
  var ui = DocumentApp.getUi();
  if (!Ggit_uiRequireInit_(ui)) return;
  var refs = Ggit_uiListRefs();
  if (!refs.commits.length) {
    ui.alert('ggit goto', '移動先のコミットがありません。先にコミットしてください。', ui.ButtonSet.OK);
    return;
  }
  var optsB = refs.bookmarks.map(function (b) {
    return '<option value="' + Ggit_esc(b.name) + '">' + Ggit_esc('ブックマーク: ' + b.name + ' @ ' + b.commitId) + '</option>';
  }).join('');
  var optsC = refs.commits.map(function (c) {
    return '<option value="' + Ggit_esc(c.id) + '">' + Ggit_esc('コミット: ' + c.id + ' — ' + c.message) + '</option>';
  }).join('');

  var html =
    '<div style="font:13px/1.5 Roboto,Arial,sans-serif;padding:4px">' +
    '<p>現在地 @ を選択先へ移動し、現在のタブの本文をその内容に置き換えます。' +
    '未コミットの変更はスタッシュ（仮コミット）へ自動退避します。</p>' +
    '移動先: <select id="t">' + optsB + optsC + '</select> ' +
    '<button id="go" onclick="run()">移動</button>' +
    '<div id="out" style="margin-top:8px"></div>' +
    '<script>' +
    'function run(){document.getElementById("go").disabled=true;' +
    'var t=document.getElementById("t").value;' +
    'document.getElementById("out").innerText="移動中…";' +
    'google.script.run.withSuccessHandler(function(r){' +
    'document.getElementById("out").innerText="現在地 @ を "+r.commitId+" へ移動しました。"+(r.stashed?"（未コミット内容をスタッシュに退避）":"");' +
    'document.getElementById("go").disabled=false;})' +
    '.withFailureHandler(function(e){document.getElementById("out").innerText=e.message;document.getElementById("go").disabled=false;})' +
    '.Ggit_goto(t);}' +
    '</script></div>';
  Ggit_showModal(html, 'ggit goto', 560, 300);
}

function ggitUI_status() {
  var ui = DocumentApp.getUi();
  if (!Ggit_uiRequireInit_(ui)) return;
  var doc = DocumentApp.getActiveDocument();
  var store = Ggit_storeLoad(doc);
  var working = Ggit_resolveWorking(doc, store);
  if (!working) {
    ui.alert('ggit', 'まだコミットがありません。Commit… で最初のコミットを作成してください。', ui.ButtonSet.OK);
    return;
  }
  var bm = [];
  for (var k in store.bookmarks) {
    if (store.bookmarks.hasOwnProperty(k)) bm.push(k + ' @ ' + store.bookmarks[k]);
  }
  var stashes = Ggit_listStashes(store);
  ui.alert('ggit',
    '現在地 @: ' + working + '\n' +
    'このコミットまでの履歴: ' + Ggit_logChain(store, working).length + '\n' +
    'ブックマーク: ' + (bm.length ? bm.join(', ') : '（なし）') + '\n' +
    'スタッシュ: ' + stashes.length + ' 件', ui.ButtonSet.OK);
}

function ggitUI_repair() {
  var ui = DocumentApp.getUi();
  if (!Ggit_uiRequireInit_(ui)) return;
  var res = ui.alert('ggit 修復',
    '壊れた履歴（破棄されたスタッシュ等で親を失ったコミット）を復旧します。\n\n' +
    '・現在地 @ の本文が復元できない場合、いま開いているタブの本文を @ の内容として作り直します。\n' +
    '  → 必ず @ の作業タブを開いた状態で実行してください。\n' +
    '・親を失ったその他のコミットは根として切り離します（差分連鎖が壊れたものは本文を復元できません）。\n\n' +
    '実行しますか？', ui.ButtonSet.OK_CANCEL);
  if (res !== ui.Button.OK) return;
  try {
    var r = Ggit_repairStore();
    ui.alert('ggit 修復',
      '完了しました。\n' +
      '現在地 @ の再構築: ' + (r.recoveredWorking ? 'あり（タブ本文から復元）' : 'なし') + '\n' +
      '切り離した参照: ' + r.detached + ' 件\n' +
      (r.lost.length ? '本文を復元できなかったコミット: ' + r.lost.join(', ')
                     : '本文の欠落はありませんでした'),
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('ggit 修復', e.message, ui.ButtonSet.OK);
  }
}

/**
 * 整合性チェック / 復旧。
 * `.vcs` タブと PropertiesService バックアップを世代（gen）で収束させる。ネイティブ版復元による
 * 巻き戻し（backup.gen > tab.gen）を検知したらバックアップからタブをヒールし、保留中の非同期
 * バックアップがあれば完了させる。バックアップ使用量（~500KB 上限への余裕）も表示する。
 */
function ggitUI_reconcile() {
  var ui = DocumentApp.getUi();
  try {
    var doc = DocumentApp.getActiveDocument();
    var dirtyBefore = Ggit_isDirty_();
    var r = Ggit_convergeStores_(doc);
    Ggit_clearBackupTriggers_();

    var bytes = Ggit_backupBytes(doc);
    var limit = 500 * 1024;
    var err = null;
    try { err = PropertiesService.getDocumentProperties().getProperty(GGIT_ERR_KEY); } catch (_) {}

    var lines = [];
    lines.push('.vcs タブ世代 (gen): ' + (r.tabGen == null ? '（メタタブ無し）' : r.tabGen));
    lines.push('バックアップ世代 (gen): ' + (r.bkGen == null ? '（バックアップ無し）' : r.bkGen));
    lines.push('バックアップ使用量: 約 ' + Math.round(bytes / 1024) + ' KB / 上限 約 500 KB');
    lines.push('');

    if (r.healedTab) {
      lines.push('⚠ ネイティブ版復元による巻き戻しを検出し、履歴を復旧しました' +
        '（gen ' + (r.tabGen == null ? '無し' : r.tabGen) + ' → ' + r.pickGen + '）。');
    } else if (dirtyBefore) {
      lines.push('保留中のバックアップを完了しました（gen ' + r.pickGen + '）。');
    } else {
      lines.push('整合しています（巻き戻しは検出されませんでした）。');
    }
    if (err) {
      lines.push('');
      lines.push('※ 直近のバックアップ警告: ' + err);
    }
    if (bytes > limit * 0.8) {
      lines.push('');
      lines.push('※ バックアップ使用量が上限に近づいています。「圧縮 / 清書」での清書、または' +
        ' Drive サイドカーへの移行を検討してください（設計仕様書 §5.2 案C）。');
    }
    ui.alert('ggit 整合性チェック', lines.join('\n'), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('ggit 整合性チェック', 'エラー: ' + e.message, ui.ButtonSet.OK);
  }
}

/**
 * 圧縮 / 清書（コンパクション）。
 * 追記で溜まった `.vcs` ログの古い meta 行と、Properties バックアップの孤立キーを掃除し、
 * 現状に即した最小形（単一 meta の JSONL ＋ 現行オブジェクトのみ）へ書き直す。
 */
function ggitUI_compact() {
  var ui = DocumentApp.getUi();
  if (!Ggit_uiRequireInit_(ui)) return;
  try {
    var r = Ggit_compact();
    ui.alert('ggit 圧縮 / 清書',
      '.vcs タブと Properties バックアップを現状に即して清書しました。\n' +
      '世代 (gen): ' + r.gen + '\n' +
      'オブジェクト数: ' + r.objects + '\n' +
      'バックアップ使用量: 約 ' + Math.round(r.bytes / 1024) + ' KB / 上限 約 500 KB',
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('ggit 圧縮 / 清書', 'エラー: ' + e.message, ui.ButtonSet.OK);
  }
}

function ggitUI_about() {
  var html =
    '<div style="font:13px/1.6 Roboto,Arial,sans-serif;padding:8px">' +
    '<b>ggit</b> — Googleドキュメント単体で動く Git/Jujutsu 風バージョン管理ツール<br>' +
    '1枚の作業タブの中で commit / log（グラフ）/ diff / bookmark / goto / merge を提供します。' +
    '<b>diff・bookmark・merge・移動(goto) は Log（グラフ）画面に統合</b>され、行を選択してその場で実行できます。<br><br>' +
    '<b>Jujutsu 流モデル</b>: 現在地 <code>@</code> はコミットID（匿名ヘッド）。commit は <code>@</code> を' +
    '前進させますが、<b>ブックマークは手動で set/move したときだけ動きます</b>。Log はブランチ（分岐）を' +
    '意識した ASCII レーングラフで表示し、フラット表示・直線表示（選択地点→ルート）にも切替できます。<br><br>' +
    'スタッシュは <code>.vcs</code> の中に「<b>スタッシュだと分かる仮コミット（stash:true）</b>」として' +
    '記録され、戻す（pop）と消えます。<br><br>' +
    '初回は <b>「初期化（権限付与・.vcs作成）」</b>を実行してください。権限付与と <code>.vcs</code> 作成までを' +
    'これ1つで完結します。<br>' +
    'commit は <code>@</code> を移しても消えず、<b>匿名ヘッド</b>として Log に残ります。不要な枝は葉の' +
    '<b>「破棄」</b>で削除できます。内容を復元できない<b>壊れたコミット</b>だけは表示されず、' +
    '<b>「掃除」</b>でまとめて削除できます（現在地 @ は残ります）。<br><br>' +
    'オブジェクトストアは <code>.vcs</code> メタタブに<b>追記型ログ（JSONL）</b>で保存され、' +
    '<b>PropertiesService にも差分バックアップ</b>されます' +
    '（Google ネイティブ版復元で巻き戻っても「整合性チェック / 復旧」で履歴を復旧できます）。' +
    'バックアップはバックグラウンドで非同期に走り、溜まったログは「圧縮 / 清書」で最小形に書き直せます。' +
    '<code>.vcs</code> タブは手動編集しないでください。<br>' +
    'commit は本文の書式（文字・段落書式）も記録し、goto では書式ごと復元します。' +
    '差分・マージはプレーンテキストを対象とします（設計仕様書 §7.3 / §7.4）。' +
    '</div>';
  Ggit_showModal(html, 'About ggit', 520, 340);
}

// ----- File: src/Merge.js -----
/**
 * Merge.js — 3-way マージ（行単位 diff3）と衝突マーカー書き戻し。
 *
 * 設計仕様書 §7.2: 共通祖先（マージベース）を基準に3-wayマージを行い、衝突箇所には
 * Git 同様のマーカー（<<<<<<< / ======= / >>>>>>>）を本文へ書き戻す。
 *
 * 本実装は行単位の diff3 を採用する。共通祖先 O、現在のタブ（ours）A、マージ元（theirs）B を
 * 行配列に分解し、O に対する A/B の対応（LCS）から安定領域と変化領域を切り出してマージする。
 * diff-match-patch は差分の表示・パッチ生成（Snapshot 側）で用い、行単位の合流ロジックは
 * 純粋関数として本ファイルに実装する（ローカルでも単体検証可能）。
 */

/** 衝突マーカー。 */
var GGIT_CONFLICT_BEGIN = '<<<<<<< current';
var GGIT_CONFLICT_SEP = '=======';
var GGIT_CONFLICT_END = '>>>>>>> source';

/** 行分割（空文字は空配列に）。 */
function Ggit_splitLines(t) {
  return t.length ? t.split('\n') : [];
}

/** 行配列の一致判定。 */
function Ggit_arrEq(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * 最長共通部分列（LCS）の一致ペア [aIndex, bIndex] を昇順で返す。
 * 行数規模（数百行程度）を想定した O(n*m) DP。
 */
function Ggit_lcsPairs(a, b) {
  var n = a.length, m = b.length;
  var dp = [];
  for (var i = 0; i <= n; i++) {
    dp[i] = [];
    for (var j = 0; j <= m; j++) dp[i][j] = 0;
  }
  for (var i2 = n - 1; i2 >= 0; i2--) {
    for (var j2 = m - 1; j2 >= 0; j2--) {
      dp[i2][j2] = (a[i2] === b[j2])
        ? dp[i2 + 1][j2 + 1] + 1
        : Math.max(dp[i2 + 1][j2], dp[i2][j2 + 1]);
    }
  }
  var pairs = [];
  var i3 = 0, j3 = 0;
  while (i3 < n && j3 < m) {
    if (a[i3] === b[j3]) {
      pairs.push([i3, j3]);
      i3++; j3++;
    } else if (dp[i3 + 1][j3] >= dp[i3][j3 + 1]) {
      i3++;
    } else {
      j3++;
    }
  }
  return pairs;
}

/**
 * 行単位 3-way マージ。{ text, conflict } を返す。
 *  oLines: 共通祖先 / aLines: ours（現在のタブ） / bLines: theirs（マージ元）
 */
function Ggit_diff3(oLines, aLines, bLines) {
  var oa = Ggit_lcsPairs(oLines, aLines);
  var ob = Ggit_lcsPairs(oLines, bLines);
  var oToA = {}, oToB = {};
  oa.forEach(function (p) { oToA[p[0]] = p[1]; });
  ob.forEach(function (p) { oToB[p[0]] = p[1]; });

  // O のうち A・B 双方で一致した行＝安定アンカー。LCS の単調性により順序整合する。
  var anchors = [];
  for (var k = 0; k < oLines.length; k++) {
    if (oToA.hasOwnProperty(k) && oToB.hasOwnProperty(k)) anchors.push(k);
  }

  var out = [];
  var conflict = false;
  var oPrev = 0, aPrev = 0, bPrev = 0;

  function emitRegion(oLo, oHi, aLo, aHi, bLo, bHi) {
    var oSlice = oLines.slice(oLo, oHi);
    var aSlice = aLines.slice(aLo, aHi);
    var bSlice = bLines.slice(bLo, bHi);
    if (Ggit_arrEq(aSlice, oSlice)) {
      // ours 不変 → theirs を採用
      Array.prototype.push.apply(out, bSlice);
    } else if (Ggit_arrEq(bSlice, oSlice)) {
      // theirs 不変 → ours を採用
      Array.prototype.push.apply(out, aSlice);
    } else if (Ggit_arrEq(aSlice, bSlice)) {
      // 両者が同一変更 → どちらでも可
      Array.prototype.push.apply(out, aSlice);
    } else {
      // 競合
      conflict = true;
      out.push(GGIT_CONFLICT_BEGIN);
      Array.prototype.push.apply(out, aSlice);
      out.push(GGIT_CONFLICT_SEP);
      Array.prototype.push.apply(out, bSlice);
      out.push(GGIT_CONFLICT_END);
    }
  }

  for (var idx = 0; idx < anchors.length; idx++) {
    var key = anchors[idx];
    var aK = oToA[key], bK = oToB[key];
    emitRegion(oPrev, key, aPrev, aK, bPrev, bK);
    out.push(oLines[key]); // アンカー行（三者共通）
    oPrev = key + 1; aPrev = aK + 1; bPrev = bK + 1;
  }
  emitRegion(oPrev, oLines.length, aPrev, aLines.length, bPrev, bLines.length);

  return { text: out.join('\n'), conflict: conflict };
}

/** id の全祖先（自身含む）を parent/parent2 で辿った集合。 */
function Ggit_ancestorSet(store, id) {
  var seen = {};
  var stack = [id];
  while (stack.length) {
    var c = stack.pop();
    if (!c || seen[c]) continue;
    var o = store.objects[c];
    if (!o) continue;
    seen[c] = true;
    if (o.parent) stack.push(o.parent);
    if (o.parent2) stack.push(o.parent2);
  }
  return seen;
}

/** idA・idB の最近共通祖先（BFS で最初に交差したノード）。無ければ null。 */
function Ggit_findLCA(store, idA, idB) {
  var ancA = Ggit_ancestorSet(store, idA);
  var seen = {};
  var queue = [idB];
  while (queue.length) {
    var c = queue.shift();
    if (!c || seen[c]) continue;
    seen[c] = true;
    if (ancA[c]) return c;
    var o = store.objects[c];
    if (!o) continue;
    if (o.parent) queue.push(o.parent);
    if (o.parent2) queue.push(o.parent2);
  }
  return null;
}

/**
 * source（ブックマーク名 または コミットID）を現在地 working（作業タブ）へ 3-way マージする。
 * 結果（マージ後本文）を作業タブへ書き戻し、
 * { conflict, commitId, upToDate, fastForward, stashed } を返す。
 *  - upToDate : マージ元が既に取り込み済み（変更なし）。
 *  - fastForward : 現在地が マージ元の祖先 → コミットを作らず working を進める。
 *  - 競合が無い分岐合流 → parent2 付きのマージコミットを記録し working を進める。
 *  - 競合時 → マーカー入り本文を書き戻し、コミットは作らず手動解決に委ねる。
 * jj 同様、いずれもブックマークは動かさない（working＝現在地のみ移動）。
 */
function Ggit_merge(source) {
  var doc = DocumentApp.getActiveDocument();
  var tab = doc.getActiveTab();
  var tabId = tab.getId();

  var meta = Ggit_metaTab(doc);
  if (meta && tabId === meta.getId()) {
    throw new Error('.vcs メタタブ上ではマージできません。対象のタブを選択してください。');
  }

  var store = Ggit_storeLoad(doc);
  var curHead = Ggit_resolveWorking(doc, store);
  if (!curHead) throw new Error('現在地に履歴がありません。先にコミットしてください。');

  // source をコミットIDへ解決（ブックマーク名優先）。
  var srcHead = store.bookmarks.hasOwnProperty(source) ? store.bookmarks[source] : source;
  if (!store.objects.hasOwnProperty(srcHead)) {
    throw new Error('マージ元が見つかりません: ' + source);
  }
  if (srcHead === curHead) throw new Error('現在地自身はマージできません。');

  var lca = Ggit_findLCA(store, curHead, srcHead);

  // マージ元が既に現在の祖先に含まれる（取り込み済み）。
  if (lca === srcHead) {
    return { conflict: false, commitId: null, upToDate: true, fastForward: false, stashed: false };
  }

  // 早送り（fast-forward）: 現在地が マージ元の祖先 なら、コミットを作らず working を進める。
  if (lca === curHead) {
    var curSnapNow = Ggit_serializeTab(tab);
    var ffStashed = Ggit_stashIfNeeded(
      store, tab, curHead, curSnapNow, 'マージ（早送り）前の自動スタッシュ');
    Ggit_restoreTab(tab, Ggit_materialize(store, srcHead)); // テキスト＋書式ごと取り込む
    store.working = srcHead;
    Ggit_storeSave(doc, store);
    return { conflict: false, commitId: srcHead, upToDate: false, fastForward: true, stashed: ffStashed };
  }

  // 3-way マージはプレーンテキスト対象（設計仕様書 §7.3）。スナップショットから text を射影する。
  var baseText = lca ? Ggit_plainOf(Ggit_materialize(store, lca)) : '';
  var srcText = Ggit_plainOf(Ggit_materialize(store, srcHead));
  var curText = Ggit_tabText(tab); // 作業中本文（未コミット編集も取り込む）

  var merged = Ggit_diff3(
    Ggit_splitLines(baseText), Ggit_splitLines(curText), Ggit_splitLines(srcText));
  Ggit_setTabText(tab, merged.text);

  if (merged.conflict) {
    return { conflict: true, commitId: null, upToDate: false, fastForward: false, stashed: false };
  }

  // クリーンマージ → parent2 付きマージコミットを記録。
  // 合流結果（プレーン）を書き戻した後のタブをシリアライズし、全コミットを
  // 同一のスナップショット表現で統一する（移動整合判定・後続 commit の比較が安定）。
  var ts = Ggit_timestamp();
  var srcLabel = store.bookmarks.hasOwnProperty(source) ? source : srcHead;
  var msg = 'Merge ' + srcLabel + ' into ' + curHead;
  var snap = Ggit_serializeTab(tab);
  var id = Ggit_commitId(store, curHead, ts, snap);
  store.objects[id] = {
    id: id,
    parent: curHead,
    parent2: srcHead,
    message: msg,
    author: Ggit_author(),
    timestamp: ts,
    payload: Ggit_makePayload(store, curHead, snap)
  };
  store.working = id;
  Ggit_storeSave(doc, store);
  return { conflict: false, commitId: id, upToDate: false, fastForward: false, stashed: false };
}

// ----- File: src/SelfTest.js -----
/**
 * SelfTest.js — Apps Script エディタから手動実行する自己テスト。
 *
 * 実行方法: Apps Script エディタで関数を選択して実行し、実行ログ（Logger）を確認する。
 * `_test_all` を実行すると全テストを順に走らせる。
 *
 * 注: gzip / computeDigest などは GAS ランタイムが必要なため、これらはエディタ実行用。
 * 一方 diff3 / LCS / LCA は純粋関数で、ローカル（Node 等）でも検証できる。
 */

function _test_all() {
  _test_hash();
  _test_snapshotRoundTrip();
  _test_plainOf();
  _test_snapshotFormatString();
  _test_mergeNoConflict();
  _test_mergeConflict();
  _test_lca();
  _test_migrate();
  _test_graphLines();
  _test_canMaterialize();
  _test_reachable();
  _test_gcDisconnected();
  _test_abandon();
  _test_stashGuard();
  _test_firstNonStashAncestor();
  _test_tabBodyEndIndex();
  _test_pickStore();
  _test_backupChunkRoundTrip();
  _test_logRoundTrip();
  _test_logAppendReplay();
  _test_logLegacyParse();
  _test_logCorruptLineSkip();
  Logger.log('--- self-test 完了 ---');
}

function _ok(name, cond) {
  Logger.log((cond ? 'PASS' : 'FAIL') + ': ' + name);
  if (!cond) throw new Error('FAILED: ' + name);
}

function _test_hash() {
  var store = { objects: {} };
  var a = Ggit_commitId(store, null, '2026-01-01T00:00:00+09:00', 'hello');
  var b = Ggit_commitId(store, null, '2026-01-01T00:00:00+09:00', 'hello');
  var c = Ggit_commitId(store, null, '2026-01-01T00:00:00+09:00', 'world');
  _ok('hash 同一入力で同一ID', a === b);
  _ok('hash 異入力で別ID', a !== c);
  _ok('hash 既定7桁', a.length === 7);
}

/** in-memory ストアに commit を積み、各コミット本文が復元できることを確認。 */
function _test_snapshotRoundTrip() {
  var store = { version: 1, objects: {}, branches: {} };
  var branch = 't.test';

  function commit(parent, text) {
    var ts = '2026-01-01T00:00:00+09:00';
    var id = Ggit_commitId(store, parent, ts + text, text);
    store.objects[id] = {
      id: id, parent: parent, parent2: null,
      message: 'm', author: 'x', timestamp: ts,
      payload: Ggit_makePayload(store, parent, text)
    };
    return id;
  }

  var texts = ['line1\nline2', 'line1\nline2\nline3', 'CHANGED1\nline2\nline3'];
  var ids = [];
  var parent = null;
  for (var i = 0; i < texts.length; i++) {
    var id = commit(parent, texts[i]);
    ids.push(id);
    parent = id;
  }
  for (var j = 0; j < ids.length; j++) {
    _ok('materialize[' + j + '] 一致', Ggit_materialize(store, ids[j]) === texts[j]);
  }

  // delta 連鎖がフル間隔を超えるとフルが挿入されることを確認。
  var t = 'x';
  var p = null;
  var lastId = null;
  for (var k = 0; k < GGIT_FULL_INTERVAL + 2; k++) {
    t = t + '\n' + k;
    lastId = commit(p, t);
    p = lastId;
  }
  _ok('長い連鎖でも復元一致', Ggit_materialize(store, lastId) === t);
}

/** Ggit_plainOf の新形式抽出と旧プレーン payload 後方互換（純粋関数）。 */
function _test_plainOf() {
  var newSnap = JSON.stringify({ v: 1, text: 'a\nb', fmt: { runs: [], paras: [] } });
  _ok('plainOf 新形式→text', Ggit_plainOf(newSnap) === 'a\nb');
  _ok('plainOf 旧プレーン互換', Ggit_plainOf('line1\nline2') === 'line1\nline2');
  _ok('plainOf 数値風プレーン', Ggit_plainOf('123') === '123');
  _ok('plainOf JSON風プレーン', Ggit_plainOf('{"a":1}') === '{"a":1}');
}

/**
 * payload パイプライン（makePayload/materialize）が書式付きスナップショット文字列でも
 * round-trip すること、および「テキスト同一・書式のみ差」が別スナップショットになることを確認。
 */
function _test_snapshotFormatString() {
  var store = { version: 1, objects: {}, branches: {} };
  var branch = 't.fmt';
  function commit(parent, snap) {
    var ts = '2026-01-01T00:00:00+09:00';
    var id = Ggit_commitId(store, parent, ts + snap, snap);
    store.objects[id] = {
      id: id, parent: parent, parent2: null,
      message: 'm', author: 'x', timestamp: ts,
      payload: Ggit_makePayload(store, parent, snap)
    };
    return id;
  }
  var snapA = JSON.stringify({ v: 1, text: 'hello\nworld', fmt: { runs: [{ s: 0, e: 4, a: { BOLD: true } }], paras: [{ i: 0, a: {} }] } });
  var snapB = JSON.stringify({ v: 1, text: 'hello\nworld', fmt: { runs: [{ s: 0, e: 4, a: { ITALIC: true } }], paras: [{ i: 0, a: {} }] } });

  var id1 = commit(null, snapA);
  var id2 = commit(id1, snapB);
  _ok('snapshot文字列 round-trip A', Ggit_materialize(store, id1) === snapA);
  _ok('snapshot文字列 round-trip B', Ggit_materialize(store, id2) === snapB);
  _ok('書式のみ差で別スナップショット', snapA !== snapB);
  _ok('plainOf は同一テキスト', Ggit_plainOf(snapA) === Ggit_plainOf(snapB));
}

function _test_mergeNoConflict() {
  var base = Ggit_splitLines('l1\nl2\nl3\nl4\nl5');
  var ours = Ggit_splitLines('l1\nOURS2\nl3\nl4\nl5');
  var theirs = Ggit_splitLines('l1\nl2\nl3\nTHEIRS4\nl5');
  var m = Ggit_diff3(base, ours, theirs);
  _ok('merge 競合なし', m.conflict === false);
  _ok('merge 双方の変更を統合', m.text === 'l1\nOURS2\nl3\nTHEIRS4\nl5');
}

function _test_mergeConflict() {
  var m = Ggit_diff3(
    Ggit_splitLines('x\ny\nz'),
    Ggit_splitLines('x\nMINE\nz'),
    Ggit_splitLines('x\nYOURS\nz'));
  _ok('merge 競合検出', m.conflict === true);
  _ok('merge 競合マーカー', m.text.indexOf('<<<<<<<') >= 0 && m.text.indexOf('>>>>>>>') >= 0);
}

/** 旧スキーマ（v1: tabId→{head,name} / v2: branches+head+stashes）→ v3（bookmarks+working）の移行。 */
function _test_migrate() {
  // v1 → v3: branches を name キー化し bookmarks へ。head 概念が無いので working は null。
  var old = {
    version: 1, objects: {}, stashes: [],
    branches: {
      't.aaa': { head: 'c1', name: 'メイン' },
      't.bbb': { head: 'c2', name: 'feature' }
    }
  };
  var s = Ggit_migrateStore(old);
  _ok('migrate version=3', s.version === 3);
  _ok('migrate bookmarks 名前キー化', s.bookmarks['メイン'] === 'c1' && s.bookmarks['feature'] === 'c2');
  _ok('migrate working 初期 null', s.working === null);
  _ok('migrate 旧キー削除', s.branches === undefined && s.head === undefined && s.stashes === undefined);

  // 同名タブは連番で一意化する。
  var dup = {
    version: 1, objects: {}, stashes: [],
    branches: { 't.1': { head: 'h1', name: 'X' }, 't.2': { head: 'h2', name: 'X' } }
  };
  var s2 = Ggit_migrateStore(dup);
  _ok('migrate 同名は一意化', s2.bookmarks['X'] === 'h1' && s2.bookmarks['X-2'] === 'h2');

  // v2 → v3: head→working、stashes[]→stash:true コミット。
  var v2 = {
    version: 2, objects: { c9: { id: 'c9', parent: null } },
    branches: { 'メイン': 'c9' }, head: 'メイン',
    stashes: [{ id: 'st01', branchName: 'メイン', timestamp: '2026-01-02T00:00:00+09:00', message: '退避', data: 'GZIP' }]
  };
  var s3 = Ggit_migrateStore(v2);
  _ok('migrate v2 bookmarks', s3.bookmarks['メイン'] === 'c9');
  _ok('migrate v2 head→working', s3.working === 'c9');
  _ok('migrate stash→コミット化', s3.objects['st01'] && s3.objects['st01'].stash === true &&
    s3.objects['st01'].parent === 'c9' && s3.objects['st01'].payload.data === 'GZIP');

  // 既に v3 のストアは不変。
  var nv = { version: 3, objects: {}, bookmarks: { 'メイン': 'c9' }, working: 'c9' };
  var s4 = Ggit_migrateStore(nv);
  _ok('migrate v3 は不変', s4.bookmarks['メイン'] === 'c9' && s4.working === 'c9');
}

/** ASCII レーングラフ（純粋関数）: 分岐・マージの形を検証。 */
function _test_graphLines() {
  // A→B→C と B→D の分岐。bookmark main→C、working=D。
  function gline(store) {
    return Ggit_graphLines(Ggit_collectNodes(store)).map(function (r) { return r.graph; });
  }
  // payload は collectNodes の表示判定（materialize 可否）を満たすため full を与える。
  var FULL = { type: 'full', data: 'x' };
  var branch = {
    objects: {
      A: { id: 'A', parent: null, parent2: null, timestamp: '2026-06-01', payload: FULL },
      B: { id: 'B', parent: 'A', parent2: null, timestamp: '2026-06-02', payload: FULL },
      C: { id: 'C', parent: 'B', parent2: null, timestamp: '2026-06-03', payload: FULL },
      D: { id: 'D', parent: 'B', parent2: null, timestamp: '2026-06-04', payload: FULL }
    },
    working: 'D', bookmarks: { main: 'C' }
  };
  var bl = gline(branch);
  // 期待形: * (D) / | * (C) / |/ / *(B) / *(A)
  _ok('graph 分岐: collapse 行 |/ がある', bl.indexOf('|/ ') >= 0 || bl.indexOf('|/') >= 0);
  _ok('graph 分岐: 2レーン行 "| *" がある', bl.indexOf('| *') >= 0);
  _ok('graph 分岐: 行数=コミット4＋collapse1', bl.length === 5);

  // マージ: A→B、A→D、E が B と D を合流（parent2）。
  var merge = {
    objects: {
      A: { id: 'A', parent: null, parent2: null, timestamp: '2026-06-01', payload: FULL },
      B: { id: 'B', parent: 'A', parent2: null, timestamp: '2026-06-02', payload: FULL },
      D: { id: 'D', parent: 'A', parent2: null, timestamp: '2026-06-03', payload: FULL },
      E: { id: 'E', parent: 'B', parent2: 'D', timestamp: '2026-06-04', payload: FULL }
    },
    working: 'E', bookmarks: {}
  };
  var ml = gline(merge);
  _ok('graph マージ: sprout 行 |\\ がある', ml.join('\n').indexOf('|\\') >= 0);
  _ok('graph マージ: collapse 行 |/ がある', ml.join('\n').indexOf('|/') >= 0);
}

/** Ggit_canMaterialize（純粋関数）: payload 連鎖が full に届くかで復元可否を判定。 */
function _test_canMaterialize() {
  var FULL = { type: 'full', data: 'x' };
  var DELTA = { type: 'delta', data: 'd' };
  var store = {
    objects: {
      A: { id: 'A', parent: null, payload: FULL },     // full → 可
      B: { id: 'B', parent: 'A', payload: DELTA },     // full 経由で可
      C: { id: 'C', parent: 'GONE', payload: DELTA },  // 親欠落 → 不可
      D: { id: 'D', parent: 'C', payload: DELTA },     // 壊れ連鎖の子 → 不可
      E: { id: 'E', parent: null, payload: DELTA }     // delta なのに親無し → 不可
    }
  };
  _ok('canMaterialize: full は可', Ggit_canMaterialize(store, 'A') === true);
  _ok('canMaterialize: full 経由 delta は可', Ggit_canMaterialize(store, 'B') === true);
  _ok('canMaterialize: 親欠落 delta は不可', Ggit_canMaterialize(store, 'C') === false);
  _ok('canMaterialize: 壊れ連鎖の子も不可', Ggit_canMaterialize(store, 'D') === false);
  _ok('canMaterialize: 親無し delta は不可', Ggit_canMaterialize(store, 'E') === false);
  _ok('canMaterialize: 不在IDは不可', Ggit_canMaterialize(store, 'NOPE') === false);
}

/**
 * Ggit_headIds / Ggit_reachableIds / Ggit_displayableIds / Ggit_collectNodes（純粋関数）:
 * 可視ヘッド（子を持たない非スタッシュコミット＝匿名ヘッド）が到達ルートに含まれ、commit→移動で
 * ブックマーク無しの葉を置き去りにしても孤立しない（消えない）ことを確認する。
 */
function _test_reachable() {
  var FULL = { type: 'full', data: 'x' };
  var store = {
    version: 3,
    objects: {
      A: { id: 'A', parent: null, parent2: null, timestamp: '2026-06-01', payload: FULL },
      B: { id: 'B', parent: 'A', parent2: null, timestamp: '2026-06-02', payload: FULL }, // @（葉）
      C: { id: 'C', parent: 'A', parent2: null, timestamp: '2026-06-03', payload: FULL }, // 別枝の途中
      D: { id: 'D', parent: 'C', parent2: null, timestamp: '2026-06-04', payload: FULL }, // 別枝の葉＝可視ヘッド
      S: { id: 'S', parent: 'B', parent2: null, timestamp: '2026-06-05', payload: FULL, stash: true }
    },
    working: 'B', bookmarks: {}
  };
  var h = Ggit_headIds(store);
  _ok('heads: 葉 B/D がヘッド', h.B && h.D);
  _ok('heads: 内部 A/C とスタッシュ S はヘッドでない', !h.A && !h.C && !h.S);

  var r = Ggit_reachableIds(store);
  _ok('reachable: @ とその祖先', r.A && r.B);
  _ok('reachable: スタッシュもルート', r.S);
  _ok('reachable: 可視ヘッド D 経由で C/D も到達可能', r.C && r.D); // 匿名ヘッドを保持

  var show = Ggit_displayableIds(store);
  _ok('displayable: 別枝も表示（孤立しない）', show.C && show.D);
  _ok('displayable: 到達可能は表示', show.A && show.B && show.S);

  var ids = Ggit_collectNodes(store).map(function (n) { return n.id; });
  _ok('collectNodes: 全コミット A,B,C,D,S を表示',
    ids.length === 5 && ids.indexOf('C') >= 0 && ids.indexOf('D') >= 0);

  // 現在地 @ を A へ移しても、葉 B/D は可視ヘッドとして残る（commit→移動でコミットが消えない）。
  store.working = 'A';
  var r2 = Ggit_reachableIds(store);
  _ok('reachable: @ を移動しても葉 B/D は残る', r2.A && r2.B && r2.C && r2.D);
  var ids2 = Ggit_collectNodes(store).map(function (n) { return n.id; });
  _ok('collectNodes: @ 移動後も全コミットを表示', ids2.indexOf('B') >= 0 && ids2.indexOf('D') >= 0);
}

/**
 * Ggit_gcDisconnectedInStore / Ggit_countDisconnected（純粋関数）:
 * 可視ヘッドの葉は孤立扱いにせず残し、掃除対象は「壊れ（復元不能）」のみ。現在地 @ は保護、
 * 宙ぶらりんの参照を整理することを確認。
 */
function _test_gcDisconnected() {
  var FULL = { type: 'full', data: 'x' };
  var DELTA = { type: 'delta', data: 'd' };
  var store = {
    version: 3,
    objects: {
      A: { id: 'A', parent: null, parent2: null, payload: FULL },      // 健全な根
      B: { id: 'B', parent: 'A', parent2: null, payload: FULL },      // 現在地 @（健全）
      LEAF: { id: 'LEAF', parent: 'A', parent2: null, payload: FULL }, // ブックマーク無しの葉＝可視ヘッド（残る）
      BRK: { id: 'BRK', parent: 'GONE', parent2: null, payload: DELTA } // 壊れ（bookmark 参照・復元不能）
    },
    working: 'B', bookmarks: { broken: 'BRK' }
  };
  var before = Ggit_countDisconnected(store);
  _ok('count: 孤立0・壊れ1（葉は孤立しない）', before.total === 1 && before.orphans === 0 && before.broken === 1);

  var r = Ggit_gcDisconnectedInStore(store);
  _ok('gc: 壊れ1件のみ削除', r.removed.length === 1 && r.orphans === 0 && r.broken === 1);
  _ok('gc: 健全/現在地/可視ヘッドの葉は残る', !!store.objects.A && !!store.objects.B && !!store.objects.LEAF);
  _ok('gc: 壊れは消える', !store.objects.BRK);
  _ok('gc: 宙ぶらりん bookmark 除去', !store.bookmarks.hasOwnProperty('broken'));
  _ok('gc: 現在地は健全', r.workingBroken === false);
  _ok('gc後: 掃除対象ゼロ', Ggit_countDisconnected(store).total === 0);

  // 現在地 @ 自体が壊れている場合は削除せず残し、workingBroken=true を報告する。
  var s2 = {
    version: 3,
    objects: { W: { id: 'W', parent: 'GONE', parent2: null, payload: DELTA } },
    working: 'W', bookmarks: {}
  };
  var r2 = Ggit_gcDisconnectedInStore(s2);
  _ok('gc: 壊れた現在地は削除しない', !!s2.objects.W && r2.removed.length === 0);
  _ok('gc: workingBroken=true を報告', r2.workingBroken === true);
}

/**
 * Ggit_abandonInStore（純粋関数）: 葉から分岐元まで枝を刈り、共有点・現在地 @・ブックマーク先・
 * スタッシュは残す。葉以外・現在地・スタッシュの破棄は拒否することを確認。
 */
function _test_abandon() {
  var FULL = { type: 'full', data: 'x' };

  // A → B → C（破棄対象の葉）、A → M（@・別枝）。C を破棄すると C と分岐専有の B が消え、共有点 A と @ は残る。
  var store = {
    version: 3,
    objects: {
      A: { id: 'A', parent: null, parent2: null, payload: FULL },
      B: { id: 'B', parent: 'A', parent2: null, payload: FULL },
      C: { id: 'C', parent: 'B', parent2: null, payload: FULL },
      M: { id: 'M', parent: 'A', parent2: null, payload: FULL }
    },
    working: 'M', bookmarks: {}
  };
  var r = Ggit_abandonInStore(store, 'C');
  _ok('abandon: 葉 C と分岐専有の B を刈る', r.removed.length === 2 && !store.objects.C && !store.objects.B);
  _ok('abandon: 分岐元 A（@ 側で共有）は残す', !!store.objects.A);
  _ok('abandon: 現在地 @ M は残る', !!store.objects.M);

  // ブックマークが枝の途中 B を指す場合、B で止まる（C のみ削除）。
  var store2 = {
    version: 3,
    objects: {
      A: { id: 'A', parent: null, parent2: null, payload: FULL },
      B: { id: 'B', parent: 'A', parent2: null, payload: FULL },
      C: { id: 'C', parent: 'B', parent2: null, payload: FULL }
    },
    working: 'A', bookmarks: { keep: 'B' }
  };
  var r2 = Ggit_abandonInStore(store2, 'C');
  _ok('abandon: ブックマーク先 B で止まる', r2.removed.length === 1 && !store2.objects.C && !!store2.objects.B);

  // 後続のあるコミット・現在地 @・スタッシュは破棄不可（拒否してオブジェクトは残る）。
  var store3 = {
    version: 3,
    objects: {
      A: { id: 'A', parent: null, parent2: null, payload: FULL },
      B: { id: 'B', parent: 'A', parent2: null, payload: FULL },
      S: { id: 'S', parent: 'A', parent2: null, payload: FULL, stash: true }
    },
    working: 'B', bookmarks: {}
  };
  var threwChild = false;
  try { Ggit_abandonInStore(store3, 'A'); } catch (e) { threwChild = true; }
  _ok('abandon: 後続のあるコミットは拒否', threwChild && !!store3.objects.A);
  var threwWorking = false;
  try { Ggit_abandonInStore(store3, 'B'); } catch (e) { threwWorking = true; }
  _ok('abandon: 現在地 @ は拒否', threwWorking && !!store3.objects.B);
  var threwStash = false;
  try { Ggit_abandonInStore(store3, 'S'); } catch (e) { threwStash = true; }
  _ok('abandon: スタッシュは拒否', threwStash && !!store3.objects.S);

  // スタッシュだけが乗った葉は破棄でき、付随スタッシュも一緒に消える（実枝が無いので拒否しない）。
  // A → B（葉。子はスタッシュ S のみ）、working=A。B を破棄すると B と S が消え、分岐元 A は残る。
  var store4 = {
    version: 3,
    objects: {
      A: { id: 'A', parent: null, parent2: null, payload: FULL },
      B: { id: 'B', parent: 'A', parent2: null, payload: FULL },
      S: { id: 'S', parent: 'B', parent2: null, payload: FULL, stash: true }
    },
    working: 'A', bookmarks: {}
  };
  var r4 = Ggit_abandonInStore(store4, 'B');
  _ok('abandon: スタッシュだけの葉 B は破棄できる', !store4.objects.B && r4.removed.length === 1);
  _ok('abandon: 付随スタッシュ S も一緒に破棄', !store4.objects.S && r4.droppedStashes.length === 1);
  _ok('abandon: 分岐元 A は残す', !!store4.objects.A);
}

/**
 * Ggit_tabBodyEndIndex_ が Docs.Documents.get レスポンス（モック）から、
 * トップ階層タブ・子タブそれぞれの本文末尾 endIndex を返すことを確認。
 * これは `.vcs` を Docs API で安全に書き戻す Ggit_setTabTextApi の前提となる純粋ロジック。
 */
function _test_tabBodyEndIndex() {
  var res = {
    tabs: [
      { tabProperties: { tabId: 't.parent' },
        documentTab: { body: { content: [{ endIndex: 1 }, { endIndex: 42 }] } },
        childTabs: [
          { tabProperties: { tabId: 't.child' },
            documentTab: { body: { content: [{ endIndex: 1 }, { endIndex: 7 }] } } }
        ] }
    ]
  };
  _ok('tabBodyEndIndex: トップ階層', Ggit_tabBodyEndIndex_(res, 't.parent') === 42);
  _ok('tabBodyEndIndex: 子タブ', Ggit_tabBodyEndIndex_(res, 't.child') === 7);
}

/**
 * Ggit_firstNonStashAncestor_ が、スタッシュ（stash:true）を飛ばして直近の実コミットを返し、
 * 連鎖が欠落していれば null を返すことを確認する（commit がスタッシュを親に取らない保証）。
 */
function _test_firstNonStashAncestor() {
  var store = {
    objects: {
      A: { id: 'A', parent: null, parent2: null },
      S: { id: 'S', parent: 'A', parent2: null, stash: true },
      S2: { id: 'S2', parent: 'S', parent2: null, stash: true },
      B: { id: 'B', parent: 'S', parent2: null }
    }
  };
  _ok('firstNonStashAncestor: スタッシュを飛ばし実祖先A', Ggit_firstNonStashAncestor_(store, 'S') === 'A');
  _ok('firstNonStashAncestor: 二段スタッシュもA', Ggit_firstNonStashAncestor_(store, 'S2') === 'A');
  _ok('firstNonStashAncestor: 実コミットは自身', Ggit_firstNonStashAncestor_(store, 'B') === 'B');
  _ok('firstNonStashAncestor: 連鎖欠落はnull',
    Ggit_firstNonStashAncestor_({ objects: { X: { id: 'X', parent: 'GONE', stash: true } } }, 'X') === null);
}

function _test_lca() {
  var store = {
    objects: {
      A: { id: 'A', parent: null, parent2: null },
      B: { id: 'B', parent: 'A', parent2: null },
      C: { id: 'C', parent: 'A', parent2: null },
      D: { id: 'D', parent: 'B', parent2: null }
    }
  };
  _ok('LCA(D,C)=A', Ggit_findLCA(store, 'D', 'C') === 'A');
  _ok('LCA(D,B)=B', Ggit_findLCA(store, 'D', 'B') === 'B');
}

/**
 * スタッシュの no-op ガード: 内容（テキスト）が履歴上のいずれかのコミット/スタッシュと
 * 同一なら退避（仮コミット作成）しないことを確認する（書式のみ差も同一扱い）。
 * 注: Ggit_stashIfNeeded の第2引数 tab は本体で未使用なので null を渡す。
 *     makePayload/materialize は GAS ランタイム依存のためエディタ実行用。
 */
function _test_stashGuard() {
  var store = { version: 3, objects: {}, bookmarks: {}, working: null };
  function commit(parent, snap) {
    var ts = '2026-01-01T00:00:00+09:00';
    var id = Ggit_commitId(store, parent, ts + snap, snap);
    store.objects[id] = {
      id: id, parent: parent, parent2: null,
      message: 'm', author: 'x', timestamp: ts,
      payload: Ggit_makePayload(store, parent, snap)
    };
    return id;
  }
  function snapOf(text) {
    return JSON.stringify({ v: 1, text: text, fmt: { runs: [], paras: [] } });
  }
  var snapA = snapOf('A'), snapB = snapOf('B'), snapC = snapOf('C');
  var a = commit(null, snapA);
  var b = commit(a, snapB);
  store.working = b;

  // 現在地コミット(b)と同一 → 作らない（従来どおり）。
  _ok('stash 現在地と同一は作らない', Ggit_stashIfNeeded(store, null, b, snapB, 'm') === false);
  // 現在地以外の既存コミット(a)と同一 → 作らない（今回の拡張点）。
  _ok('stash 任意コミットと同一は作らない', Ggit_stashIfNeeded(store, null, b, snapA, 'm') === false);
  // テキスト同一・書式のみ差 → 作らない（テキストベース比較）。
  var snapBfmt = JSON.stringify({ v: 1, text: 'B', fmt: { runs: [{ s: 0, e: 0, a: { BOLD: true } }], paras: [] } });
  _ok('stash 書式のみ差は作らない（テキスト基準）', Ggit_stashIfNeeded(store, null, b, snapBfmt, 'm') === false);

  // どのコミットとも異なる新規内容 → 作る。objects が1件増える。
  var before = 0;
  for (var k0 in store.objects) { if (store.objects.hasOwnProperty(k0)) before++; }
  _ok('stash 新規内容は作る', Ggit_stashIfNeeded(store, null, b, snapC, '退避') === true);
  var after = 0;
  for (var k1 in store.objects) { if (store.objects.hasOwnProperty(k1)) after++; }
  _ok('stash 作成で objects 増加', after === before + 1);

  // 直前で作ったスタッシュと同一内容 → 作らない（重複防止が維持）。
  _ok('stash 同一スタッシュは重複させない', Ggit_stashIfNeeded(store, null, b, snapC, '退避') === false);
}

/**
 * Ggit_pickStore の採用ロジック（純粋関数）。
 * 巻き戻し検知＝backup.gen > tab.gen で backup を採用することを中心に各分岐を検証。
 */
function _test_pickStore() {
  var tab = { version: 3, gen: 2, objects: { a: 1 }, bookmarks: {}, working: null };
  var bk5 = { version: 3, gen: 5, objects: { a: 1, b: 1 }, bookmarks: {}, working: null };
  var bk1 = { version: 3, gen: 1, objects: {}, bookmarks: {}, working: null };

  _ok('pickStore: 巻き戻し検知で backup 採用', Ggit_pickStore(tab, bk5) === bk5);
  _ok('pickStore: タブが新しければ tab 採用', Ggit_pickStore(tab, bk1) === tab);
  _ok('pickStore: 同点はタブ優先', Ggit_pickStore({ gen: 3 }, { gen: 3 }).gen === 3 &&
    Ggit_pickStore(tab, { gen: 2, objects: {}, bookmarks: {}, working: null }) === tab);
  _ok('pickStore: backup 欠落で tab 採用', Ggit_pickStore(tab, null) === tab);
  _ok('pickStore: tab 欠落で backup 採用', Ggit_pickStore(null, bk5) === bk5);
  _ok('pickStore: 両方欠落で空ストア', Ggit_pickStore(null, null).gen === 0);
}

/**
 * バックアップのチャンク分割→結合が原本一致すること（純粋関数）。
 * gzip 圧縮の往復は GAS ランタイムが必要なため別途（_test_snapshotRoundTrip 等）に委ね、
 * ここではチャンク化（Ggit_chunk）の分割/結合の正しさのみを検証する。
 */
function _test_backupChunkRoundTrip() {
  var big = '';
  for (var i = 0; i < 5000; i++) big += (i % 10);
  var chunks = Ggit_chunk(big, 8000);
  _ok('chunk: 分割数が想定どおり', chunks.length === 1);
  _ok('chunk: 結合で原本一致(小)', chunks.join('') === big);

  var chunks2 = Ggit_chunk(big, 700);
  _ok('chunk: 複数分割', chunks2.length === Math.ceil(big.length / 700));
  _ok('chunk: 各チャンクが上限以下', chunks2.every(function (c) { return c.length <= 700; }));
  _ok('chunk: 結合で原本一致(分割)', chunks2.join('') === big);
  _ok('chunk: 空文字は空配列', Ggit_chunk('', 700).length === 0);
}

/** 純粋関数: JSONL ログの清書→解析ラウンドトリップ（オブジェクト・bookmarks・working・gen の一致）。 */
function _test_logRoundTrip() {
  var store = {
    version: 3, gen: 7,
    objects: {
      a1b2c3d: { id: 'a1b2c3d', parent: null, message: 'm1', payload: { type: 'full', data: 'X' } },
      e4f5a6b: { id: 'e4f5a6b', parent: 'a1b2c3d', message: 'm2', payload: { type: 'delta', data: 'Y' } }
    },
    bookmarks: { main: 'e4f5a6b' }, working: 'e4f5a6b'
  };
  var text = Ggit_logRewrite_(store);
  var back = Ggit_logParse_(text);
  _ok('log: 新形式として解析される', back.__logok === true);
  _ok('log: gen 一致', back.gen === 7);
  _ok('log: meta 行は1つ', back.__metaSeen === 1);
  _ok('log: working 一致', back.working === 'e4f5a6b');
  _ok('log: bookmark 一致', back.bookmarks.main === 'e4f5a6b');
  _ok('log: オブジェクト2件復元', back.objects.a1b2c3d && back.objects.e4f5a6b &&
    back.objects.e4f5a6b.payload.data === 'Y');
  _ok('log: __persistedIds に2件', !!(back.__persistedIds.a1b2c3d && back.__persistedIds.e4f5a6b));
}

/** 純粋関数: 清書後に追記した行をリプレイし、最後の meta を採用すること。 */
function _test_logAppendReplay() {
  var store = {
    version: 3, gen: 1,
    objects: { a1b2c3d: { id: 'a1b2c3d', parent: null, payload: { type: 'full', data: 'X' } } },
    bookmarks: {}, working: 'a1b2c3d'
  };
  var text = Ggit_logRewrite_(store);

  // 2回目の保存を追記でシミュレート（新オブジェクト e4f5a6b、gen=2、working 前進）。
  store.gen = 2;
  store.objects.e4f5a6b = { id: 'e4f5a6b', parent: 'a1b2c3d', payload: { type: 'delta', data: 'Y' } };
  store.working = 'e4f5a6b';
  text = text + Ggit_logAppend_(store, ['e4f5a6b']);

  var back = Ggit_logParse_(text);
  _ok('logAppend: 最後の meta(gen=2) を採用', back.gen === 2);
  _ok('logAppend: meta 行は2つ', back.__metaSeen === 2);
  _ok('logAppend: working 前進が反映', back.working === 'e4f5a6b');
  _ok('logAppend: 追記オブジェクトが復元', !!back.objects.e4f5a6b);
}

/** 純粋関数: 旧形式（単一 JSON ストア）を後方互換で読み、v3 へ移行できること。 */
function _test_logLegacyParse() {
  var legacy = JSON.stringify({
    version: 3, gen: 3, objects: { z: { id: 'z' } }, bookmarks: { b: 'z' }, working: 'z'
  });
  var back = Ggit_logParse_(legacy);
  _ok('legacy: 旧形式として解析される', back.__logok === false);
  _ok('legacy: gen 一致', back.gen === 3);
  _ok('legacy: working 一致', back.working === 'z');
  _ok('legacy: オブジェクト復元', !!back.objects.z);
}

/** 純粋関数: ログ末尾の破損行（版復元の切れ等）はスキップし、直前の有効状態を採ること。 */
function _test_logCorruptLineSkip() {
  var store = {
    version: 3, gen: 4,
    objects: { a1b2c3d: { id: 'a1b2c3d', parent: null, payload: { type: 'full', data: 'X' } } },
    bookmarks: {}, working: 'a1b2c3d'
  };
  var text = Ggit_logRewrite_(store) + '\n{"o":"broke","v":{partial'; // 末尾切れ
  var back = Ggit_logParse_(text);
  _ok('corrupt: 破損行を無視して解析成功', back.gen === 4);
  _ok('corrupt: 破損オブジェクトは未追加', !back.objects.broke);
  _ok('corrupt: 健全オブジェクトは残る', !!back.objects.a1b2c3d);
}

// ----- File: src/Snapshot.js -----
/**
 * Snapshot.js — payload（full/delta）の生成・復元と gzip+Base64 圧縮。
 *
 * 設計仕様書 §5.1 / §5.3:
 *  - payload.type = "full"  … 本文全文を gzip+Base64
 *  - payload.type = "delta" … 親→当該コミットの diff-match-patch パッチを gzip+Base64
 *  - 一定間隔でフルスナップショット（基準点）を挿入し、復元時の差分連鎖を短く保つ。
 */

/** delta が連続する上限。これを超える前にフルスナップショットを挿入する。 */
var GGIT_FULL_INTERVAL = 20;

/** テキストを gzip+Base64 で圧縮。 */
function Ggit_gzipB64(text) {
  var gz = Utilities.gzip(Utilities.newBlob(text, 'text/plain'));
  return Utilities.base64Encode(gz.getBytes());
}

/** gzip+Base64 を復号してテキストへ戻す。 */
function Ggit_gunzipB64(b64) {
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip');
  return Utilities.ungzip(blob).getDataAsString('UTF-8');
}

/** parentId から遡り、直近のフルスナップショットまでの delta 連続数を返す。 */
function Ggit_deltasSinceFull(store, parentId) {
  var n = 0, id = parentId;
  while (id) {
    var o = store.objects[id];
    if (!o) break;
    if (o.payload.type === 'full') break;
    n++;
    id = o.parent;
  }
  return n;
}

/**
 * 親と本文から payload を生成する。
 * 親が無い、または delta 連鎖が上限間際なら full、それ以外は delta。
 */
function Ggit_makePayload(store, parentId, fullText) {
  if (!parentId) {
    return { type: 'full', data: Ggit_gzipB64(fullText) };
  }
  if (Ggit_deltasSinceFull(store, parentId) >= GGIT_FULL_INTERVAL - 1) {
    return { type: 'full', data: Ggit_gzipB64(fullText) };
  }
  var parentText = Ggit_materialize(store, parentId);
  var dmp = new diff_match_patch();
  var patches = dmp.patch_make(parentText, fullText);
  return { type: 'delta', data: Ggit_gzipB64(dmp.patch_toText(patches)) };
}

/**
 * 指定コミットの本文を実際に復元せずに「復元可能か」を構造的に判定する純粋関数。
 *
 * materialize と同じ向き（payload が delta の間だけ parent を辿り、full に当たれば確定）で
 * 連鎖を辿り、full に到達できれば true。途中で参照先オブジェクトが欠落していたり
 * （例: 親が破棄された 5653e7bf を指す）、payload が無い／delta なのに親が無い場合は
 * 連鎖が「繋がっていない」ため false（＝壊れたコミット）。
 *
 * GAS ランタイム非依存（gzip/Docs API を呼ばない）なので SelfTest でユニット検証できる。
 */
function Ggit_canMaterialize(store, id) {
  var objects = store.objects || {};
  var cur = id;
  for (var guard = 0; cur && guard < 1000000; guard++) {
    var o = objects[cur];
    if (!o || !o.payload) return false; // 参照先欠落 or payload 欠落 → 復元不能
    if (o.payload.type === 'full') return true; // 基準点に到達
    cur = o.parent; // delta は親方向へ
  }
  return false; // full に当たらず連鎖が尽きた（delta なのに親が無い等）
}

/**
 * 指定コミットの本文全文を復元する。
 * コミットから親方向へ直近の full まで遡り、full 本文に delta を順方向適用する。
 */
function Ggit_materialize(store, id) {
  var chain = [];
  var cur = id;
  while (cur) {
    var o = store.objects[cur];
    if (!o) throw new Error('オブジェクトが見つかりません: ' + cur);
    chain.push(o);
    if (o.payload.type === 'full') break;
    cur = o.parent;
  }
  chain.reverse(); // [full(基準点), delta, delta, ... , target]

  var text = Ggit_gunzipB64(chain[0].payload.data);
  var dmp = new diff_match_patch();
  for (var i = 1; i < chain.length; i++) {
    var patches = dmp.patch_fromText(Ggit_gunzipB64(chain[i].payload.data));
    text = dmp.patch_apply(patches, text)[0];
  }
  return text;
}

/* ===================== 書式付きスナップショット（スコープ①: 記録＋復元） ===================== */
/*
 * payload に格納する「素材」を、プレーンテキストから構造化 JSON 文字列に拡張する。
 *   { "v":1, "text": <body.getText() と一致する全文>,
 *     "fmt": { "runs":[{s,e,a}], "paras":[{i,a}] } }
 * - text を diff/merge がそのまま射影（Ggit_plainOf）して使うため、プレーン処理は無改変。
 * - fmt を含めて比較することで「テキスト同一・書式のみ変更」を commit が検知できる。
 * - 圧縮/delta/コミットID は文字列処理なので、この JSON 文字列をそのまま流せる（無改修）。
 *
 * 後方互換: 旧 `.vcs`（payload が生プレーンテキスト）も Ggit_parseSnap / Ggit_plainOf が
 * 透過的に読めるため、既存ドキュメントを壊さない。
 *
 * フィデリティ境界（①）: 文字書式・段落書式のみ対応。表/画像/リストのグリフ・ネストは
 * 非対応（テキストとしては保持されるが書式は復元しない）。設計仕様書 §7.3 に整合。
 */

/** スナップショット文字列を { v, text, fmt } へ復号。旧プレーン payload は {text:raw} 扱い。 */
function Ggit_parseSnap(s) {
  if (s == null) return { v: 0, text: '', fmt: null };
  var o = null;
  try { o = JSON.parse(s); } catch (e) { o = null; }
  if (o && typeof o === 'object' && o.v && typeof o.text === 'string') return o;
  // 旧形式（生プレーンテキスト）または非該当 JSON はそのままテキストとして扱う。
  return { v: 0, text: String(s), fmt: null };
}

/** スナップショット文字列からプレーン全文を取り出す（diff/merge 用・後方互換）。 */
function Ggit_plainOf(s) {
  return Ggit_parseSnap(s).text;
}

/** オブジェクトに列挙可能キーが1つでもあるか。 */
function Ggit_hasKeys(o) {
  for (var k in o) { if (o.hasOwnProperty(k)) return true; }
  return false;
}

/** 文字列値の属性名→列挙型のマップ（①で復元対象とする段落系 enum のみ）。 */
function Ggit_enumFromString(attrKey, name) {
  var maps = {
    HEADING: DocumentApp.ParagraphHeading,
    HORIZONTAL_ALIGNMENT: DocumentApp.HorizontalAlignment
  };
  var e = maps[attrKey];
  if (!e) return null;
  var v = e[name];
  return v === undefined ? null : v;
}

/**
 * getAttributes() の戻り値を JSON 安全な形へ正規化する。
 * - null/undefined は捨てる（未設定属性でストアを肥大させない）。
 * - 文字列/数値/真偽はそのまま。
 * - それ以外（列挙型など）は { __enum: <toString> } で名前を保持する。
 */
function Ggit_normAttrs(attrs) {
  var out = {};
  for (var k in attrs) {
    if (!attrs.hasOwnProperty(k)) continue;
    var v = attrs[k];
    if (v === null || v === undefined) continue;
    var tv = typeof v;
    if (tv === 'string' || tv === 'number' || tv === 'boolean') {
      out[k] = v;
    } else {
      out[k] = { __enum: String(v) };
    }
  }
  return out;
}

/** 正規化属性を setAttributes() 適用可能な形へ戻す。復元不能な enum は捨てる（①の境界）。 */
function Ggit_denormAttrs(obj) {
  var out = {};
  for (var k in obj) {
    if (!obj.hasOwnProperty(k)) continue;
    var v = obj[k];
    if (v && typeof v === 'object' && v.__enum !== undefined) {
      var e = Ggit_enumFromString(k, v.__enum);
      if (e !== null) out[k] = e; // 未対応 enum は適用しない
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** body の段落系要素（Paragraph / ListItem）を本文順で返す。 */
function Ggit_paraElements(body) {
  var out = [];
  var n = body.getNumChildren();
  for (var i = 0; i < n; i++) {
    var c = body.getChild(i);
    var t = c.getType();
    if (t === DocumentApp.ElementType.PARAGRAPH || t === DocumentApp.ElementType.LIST_ITEM) {
      out.push(c);
    }
  }
  return out;
}

/**
 * タブ本文を書式付きスナップショット文字列としてシリアライズする。
 * 文字書式は body.editAsText() の属性区間、段落書式は段落系要素の属性として取得する。
 */
function Ggit_serializeTab(tab) {
  var body = tab.asDocumentTab().getBody();
  var text = body.getText();

  var runs = [];
  if (text.length > 0) {
    var et = body.editAsText();
    var idx = et.getTextAttributeIndices();
    for (var i = 0; i < idx.length; i++) {
      var s = idx[i];
      var e = (i + 1 < idx.length) ? idx[i + 1] - 1 : text.length - 1; // 終端は inclusive
      if (e < s) continue;
      runs.push({ s: s, e: e, a: Ggit_normAttrs(et.getAttributes(s)) });
    }
  }

  var paras = [];
  var pels = Ggit_paraElements(body);
  for (var j = 0; j < pels.length; j++) {
    paras.push({ i: j, a: Ggit_normAttrs(pels[j].getAttributes()) });
  }

  return JSON.stringify({ v: 1, text: text, fmt: { runs: runs, paras: paras } });
}

/**
 * スナップショット文字列をタブ本文へ復元する（テキスト＋書式）。
 * setText 後に段落属性→文字属性の順で再適用する（段落の NamedStyle が文字属性を
 * 上書きしうるため、文字属性を後に当てて明示書式を優先する）。
 */
function Ggit_restoreTab(tab, snapStr) {
  var body = tab.asDocumentTab().getBody();
  var snap = Ggit_parseSnap(snapStr);
  var text = snap.text;
  body.setText(text);
  if (!snap.fmt) return; // 旧プレーン payload はテキストのみ復元。

  var pels = Ggit_paraElements(body);
  var paras = snap.fmt.paras || [];
  for (var j = 0; j < paras.length; j++) {
    var p = paras[j];
    if (p.i < pels.length) {
      var pa = Ggit_denormAttrs(p.a);
      if (Ggit_hasKeys(pa)) pels[p.i].setAttributes(pa);
    }
  }

  if (text.length > 0) {
    var et = body.editAsText();
    var runs = snap.fmt.runs || [];
    for (var k = 0; k < runs.length; k++) {
      var r = runs[k];
      var ra = Ggit_denormAttrs(r.a);
      if (Ggit_hasKeys(ra) && r.e >= r.s) et.setAttributes(r.s, r.e, ra);
    }
  }
}

// ----- File: src/Stash.js -----
/**
 * Stash.js — スタッシュ（＝stash:true 付きの仮コミット）。
 *
 * 要望1: スタッシュは DAG の外ではなく、objects 内の「コミットだけどスタッシュだと分かる」
 * stash:true 付きコミットとして記録する。goto / 復元で上書きされて失われる未コミット内容を、
 * その時点の現在地 working を親とする仮コミットへ退避する（git stash 相当）。
 *
 * 「そこに戻ったらスタッシュを消す」= pop（Ggit_popStash）: スタッシュ内容を作業タブへ戻し、
 * working をスタッシュの親へ移してから、その仮コミットを objects から削除する。
 */

/** スタッシュID（親＋timestamp＋本文の SHA-256 短縮）。 */
function Ggit_stashId(parentId, timestamp, snap) {
  return Ggit_sha256Hex((parentId || '') + '\n' + timestamp + '\n' + snap).substring(0, 8);
}

/**
 * 現在のスナップショット curSnap を必要ならスタッシュ（仮コミット）へ退避する。
 * 退避した場合 true。内容（テキスト）が履歴上のいずれかのコミット/スタッシュと
 * 同一なら false（既に保存済みで上書きしても失われないため）。
 * 同一判定はテキストベース: 書式のみの差は「同じ内容」とみなして退避しない。
 * parentId は退避元の現在地 working（仮コミットの親・pop で戻る先）。
 * store は破壊的に更新するが保存は呼び出し側で行う。
 */
function Ggit_stashIfNeeded(store, tab, parentId, curSnap, message) {
  // 内容（テキスト）が履歴上のいずれかのコミット/スタッシュと同一なら、既に保存済みで
  // 上書きしても失われないため退避不要（現在地コミットも含めて走査する）。
  // 比較はテキストベース（Ggit_plainOf）: 書式のみ異なる場合は同一とみなす。
  var curText = Ggit_plainOf(curSnap);
  for (var k in store.objects) {
    if (!store.objects.hasOwnProperty(k)) continue;
    if (Ggit_plainOf(Ggit_materialize(store, k)) === curText) return false;
  }

  var ts = Ggit_timestamp();
  var id = Ggit_stashId(parentId, ts, curSnap);
  while (store.objects.hasOwnProperty(id)) id = id + 'x';
  store.objects[id] = {
    id: id,
    parent: parentId || null,
    parent2: null,
    message: message || '自動スタッシュ（復元前）',
    author: Ggit_author(),
    timestamp: ts,
    payload: Ggit_makePayload(store, parentId, curSnap),
    stash: true
  };
  return true;
}

/** objects 内のスタッシュ（stash:true）を新しい順に一覧する。 */
function Ggit_listStashes(store) {
  var out = [];
  for (var k in store.objects) {
    if (!store.objects.hasOwnProperty(k)) continue;
    var o = store.objects[k];
    if (o.stash) out.push({ id: o.id, message: o.message, timestamp: o.timestamp, parent: o.parent });
  }
  out.sort(function (a, b) {
    var ta = a.timestamp || '', tb = b.timestamp || '';
    if (ta !== tb) return ta < tb ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
  return out;
}

/**
 * スタッシュを作業タブへ戻して消す（git stash pop 相当・要望「戻ったら消す」）。
 * 戻す前の未コミット内容は再び退避する。
 * 戻り値: { stashId, stashed, popped }。
 */
function Ggit_popStash(stashId) {
  var doc = DocumentApp.getActiveDocument();
  var tab = doc.getActiveTab();

  var meta = Ggit_metaTab(doc);
  if (meta && tab.getId() === meta.getId()) {
    throw new Error('.vcs メタタブには適用できません。対象のタブを選択してください。');
  }

  var store = Ggit_storeLoad(doc);
  var st = store.objects[stashId];
  if (!st || !st.stash) throw new Error('スタッシュが見つかりません: ' + stashId);

  var snap = Ggit_materialize(store, stashId);
  var curSnap = Ggit_serializeTab(tab);
  var cur = Ggit_resolveWorking(doc, store);

  var stashed = false;
  if (curSnap !== snap) {
    stashed = Ggit_stashIfNeeded(store, tab, cur, curSnap, 'pop 前の自動スタッシュ');
    Ggit_restoreTab(tab, snap);
  }
  // スタッシュ内容が作業タブへ戻ったので、現在地はスタッシュの親（分岐元）へ。仮コミットは削除。
  store.working = st.parent || null;
  Ggit_spliceOutObject_(store, stashId);
  Ggit_storeSave(doc, store);
  return { stashId: stashId, stashed: stashed, popped: true };
}

/** スタッシュ（仮コミット）を破棄する（git stash drop 相当）。戻り値: { stashId, dropped }。 */
function Ggit_dropStash(stashId) {
  var doc = DocumentApp.getActiveDocument();
  var store = Ggit_storeLoad(doc);
  var st = store.objects[stashId];
  if (!st || !st.stash) throw new Error('スタッシュが見つかりません: ' + stashId);
  Ggit_spliceOutObject_(store, stashId);
  Ggit_storeSave(doc, store);
  return { stashId: stashId, dropped: true };
}

/**
 * オブジェクト id を DAG から安全に取り除く（splice）。単純な delete と異なり、
 * id を親に持つ子（parent==id）を id の親へ繋ぎ直し、その payload を新親基準で作り直す。
 * payload は親との delta で保存され得るため、基準（親）を消すと子が復元不能になる。これを防ぐ。
 *
 * 注: 削除前に子本文を materialize するため id 本体はこの時点でまだ存在している必要がある
 *     （本関数の末尾で初めて delete する）。parent2（マージ第2親）が id を指す場合も繋ぎ直す。
 *
 * 通常フロー（Ggit_goto のスタッシュ移動禁止）下ではスタッシュに子は付かないが、
 * 移行データ・マージ・将来の操作に対する不変条件として常に整合を保つ。
 */
function Ggit_spliceOutObject_(store, id) {
  var victim = store.objects[id];
  if (!victim) return;
  var newParent = victim.parent || null; // スタッシュ等の親（実コミット or null）

  for (var cid in store.objects) {
    if (!store.objects.hasOwnProperty(cid)) continue;
    if (cid === id) continue;
    var c = store.objects[cid];
    if (c.parent === id) {
      var text = Ggit_materialize(store, cid);            // victim 健在のうちに本文を確定
      c.parent = newParent;
      c.payload = Ggit_makePayload(store, newParent, text); // 新親基準で payload を再生成
    }
    if (c.parent2 === id) {
      c.parent2 = newParent;                              // payload は第1親基準のため再生成不要
    }
  }
  delete store.objects[id];
}

/**
 * 壊れた履歴を復旧する（破棄済みスタッシュ等で親を失ったコミットの救済）。
 *
 * 背景: 旧バージョンはスタッシュへ @ を乗せたままコミットでき、そのスタッシュを破棄すると
 * 子コミットが親（差分の基準）を失い materialize できなくなった。本関数はそれを救済する。
 *
 * 方針:
 *  1) 現在地 @ が materialize できない（連鎖断裂）場合、いま開いているタブ本文を @ の内容として
 *     full payload で作り直す（@ の本文は作業タブに生きているため復元できる）。
 *  2) その他、親/第2親が欠落参照になっているオブジェクトは根（null）へ切り離す。delta 連鎖が
 *     壊れているものは本文を復元できないため、その旨を報告する。
 * 戻り値: { recoveredWorking, detached, lost:[id...] }。
 */
function Ggit_repairStore() {
  var doc = DocumentApp.getActiveDocument();
  var tab = doc.getActiveTab();
  var meta = Ggit_metaTab(doc);
  if (meta && tab.getId() === meta.getId()) {
    throw new Error('.vcs メタタブ上では実行できません。復旧したいタブを選択してください。');
  }

  var store = Ggit_storeLoad(doc);
  var report = { recoveredWorking: false, detached: 0, lost: [] };

  // 1) 現在地 @ が壊れていれば、作業タブ本文から full で再構築する。
  var working = store.working;
  if (working && store.objects.hasOwnProperty(working)) {
    var broken = false;
    try { Ggit_materialize(store, working); } catch (e) { broken = true; }
    if (broken) {
      var o = store.objects[working];
      o.parent = null;
      o.parent2 = null;
      o.payload = { type: 'full', data: Ggit_gzipB64(Ggit_serializeTab(tab)) };
      report.recoveredWorking = true;
    }
  }

  // 2) 残る欠落参照を根へ切り離す。
  for (var id in store.objects) {
    if (!store.objects.hasOwnProperty(id)) continue;
    var obj = store.objects[id];
    if (obj.parent && !store.objects.hasOwnProperty(obj.parent)) {
      if (obj.payload && obj.payload.type !== 'full') report.lost.push(id); // 本文復元不能
      obj.parent = null;
      report.detached++;
    }
    if (obj.parent2 && !store.objects.hasOwnProperty(obj.parent2)) {
      obj.parent2 = null;
      report.detached++;
    }
  }

  Ggit_storeSave(doc, store);
  return report;
}

// ----- File: src/Store.js -----
/**
 * Store.js — オブジェクトストア（コミットグラフ）の永続化。
 *
 * 配置は設計仕様書 §5.2 の「案A」を基本としつつ、Google ネイティブ版復元
 * （ファイル > 変更履歴 > この版に戻す）への耐性のため PropertiesService
 * （DocumentProperties）への外部バックアップを併設する「ハイブリッド」方式を採る（§5.4）。
 *
 * 背景: ネイティブ版復元はドキュメント全体を巻き戻すため、`.vcs` タブもろともメタストアが
 * 過去へ戻り、それ以降の履歴が失われる。DocumentProperties はドキュメント本文ではないため
 * 版復元の影響を受けない。これを「正」として保持し、単調増加の世代カウンタ `gen` で巻き戻しを
 * 検知して履歴を復旧する。
 *
 * ストア構造（version 3: Jujutsu 流ブックマークモデル）:
 * {
 *   "version": 3,
 *   "gen":       0,                     // 単調増加の世代カウンタ（保存ごとに +1）。巻き戻し検知用
 *   "objects":   { <commitId>: <commitObject>, ... },  // 通常コミット＋スタッシュ（stash:true）
 *   "bookmarks": { <bookmarkName>: <commitId>, ... },  // 手動の名前付きポインタ（commitで自動前進しない）
 *   "working":   <commitId>            // 現在地 @（匿名ヘッド）。未確立なら null
 * }
 * jj と同様、commit は working（現在地）だけを前進させ、ブックマークは明示操作でのみ動かす。
 * スタッシュは DAG の外ではなく objects 内の stash:true 付きコミットとして表現する（§Stash.js）。
 *
 * 旧スキーマは読み込み時に Ggit_migrateStore で自動移行する:
 *  - version 1（branches が <tabId>:{head,name}、head 概念なし。「タブ＝ブランチ」）
 *  - version 2（branches が <branchName>:<headCommitId>、head=現在ブランチ、stashes[] 配列）
 *
 * 差分・追記永続化:
 *   objects は内容ハッシュをキーにした不変オブジェクトで、1 操作で増えるのは高々 1 件。
 *   そこで毎回の全書き直しを避け、
 *   - `.vcs` タブ … 追記型ログ（JSONL）。通常保存は末尾へ 1 行追記（O(新規)）。
 *   - Properties … オブジェクト単位の KV（ggit.o.<id>）＋小さな meta。差分追記のみ。
 *   とする。古い meta 行が溜まったら／オブジェクト削除（GC）時は全清書へ切替える。
 *
 * 非同期バックアップ:
 *   Properties への書き込みは時間ベース一回限りトリガ（Ggit_backupFlush）へ後送りし、その間は
 *   dirty フラグを立てる。次の保存は冒頭で Ggit_ensureBackupFresh_ により保留中バックアップを
 *   同期収束させてから続行する（dirty ガード）。差分追記なので収束も O(新規) で軽い。
 */

var GGIT_META_TITLE = '.vcs';

/** PropertiesService バックアップ（差分追記型）のキー。 */
var GGIT_OBJ_PREFIX = 'ggit.o.';        // ggit.o.<id>.n（チャンク数）/ ggit.o.<id>.<i>（チャンク）
var GGIT_META_KEY = 'ggit.meta';        // {version,gen,bookmarks,working}（小・毎回上書き）
var GGIT_DIRTY_KEY = 'ggit.dirty';      // 非同期バックアップ未完了フラグ（保存待ち gen）
var GGIT_DOCID_KEY = 'ggit.docid';      // 時間トリガから openById するための docId
var GGIT_ERR_KEY = 'ggit.bk_err';       // 直近のバックアップ失敗理由（非同期のため後で提示）
var GGIT_BK_CHUNK = 8000;               // 1プロパティ値の上限(~9KB)を下回るチャンク長
var GGIT_BK_BATCH = 50;                 // setProperties 1回あたりにまとめるオブジェクト数

/** 旧バックアップ形式（後方互換・移行用）。 */
var GGIT_BK_PREFIX = 'ggit.bk.';        // 旧: ggit.bk.gen / ggit.bk.count / ggit.bk.<i>

/** `.vcs` 追記型ログ（JSONL）。 */
var GGIT_LOG_HEADER = 'ggit-log';       // ヘッダ行 {"h":"ggit-log",...} の目印
var GGIT_COMPACT_INTERVAL = 100;        // meta 行がこの数たまったら次回保存で全清書

/** 非同期バックアップのトリガ関数名。 */
var GGIT_BACKUP_TRIGGER = 'Ggit_backupFlush';

/** `.vcs` メタタブを返す（無ければ null）。 */
function Ggit_metaTab(doc) {
  var all = Ggit_allTabs(doc);
  for (var i = 0; i < all.length; i++) {
    if (all[i].getTitle() === GGIT_META_TITLE) return all[i];
  }
  return null;
}

/** 空のストアを生成。 */
function Ggit_emptyStore() {
  return { version: 3, gen: 0, objects: {}, bookmarks: {}, working: null };
}

/** オブジェクトマップから id 集合 {id:true} を作る。 */
function Ggit_idSet_(objects) {
  var out = {};
  for (var id in objects) { if (objects.hasOwnProperty(id)) out[id] = true; }
  return out;
}

/**
 * メタタブと PropertiesService バックアップの両方を読み、世代（gen）の新しい方を採用する。
 *
 * ネイティブ版復元で `.vcs` タブが巻き戻された場合（backup.gen > tab.gen）はバックアップを
 * 正として返し、履歴喪失を防ぐ。読み取り経路では副作用（Docs API 書き込み）を避けるためタブへの
 * 書き戻し（ヒール）は行わず、次回 Ggit_storeSave で自動反映される（遅延ヒール）。復元直後に
 * 確実に整合させたい場合はメニュー「整合性チェック / 復旧」で即時ヒールできる。
 */
function Ggit_storeLoad(doc) {
  doc = doc || DocumentApp.getActiveDocument();
  var tabStore = Ggit_tabStoreLoad(doc);
  var backupStore = Ggit_backupLoad(doc);
  return Ggit_pickStore(tabStore, backupStore);
}

/** メタタブ（`.vcs`）本文のみからストアを読み込む（無ければ null）。新旧フォーマット両対応。 */
function Ggit_tabStoreLoad(doc) {
  var t = Ggit_metaTab(doc);
  if (!t) return null;
  var raw = Ggit_tabText(t).trim();
  if (!raw) return null;
  return Ggit_logParse_(raw);
}

/**
 * `.vcs` 本文（生文字列）をストアへ解析する。
 *  - 1行目が ggit-log ヘッダなら新形式（JSONL ログ）としてリプレイ。
 *  - そうでなければ旧形式（単一 JSON ストア）として読む（後方互換）。
 * パース不能行はスキップする（版復元によるログ末尾切れ等への防御）。解析結果には保存時の
 * 判断用に非永続フィールド __logok / __metaSeen / __persistedIds を付与する。
 */
function Ggit_logParse_(raw) {
  var lines = raw.split('\n');
  var head = null;
  try { head = JSON.parse(lines[0]); } catch (e) { head = null; }

  if (!head || head.h !== GGIT_LOG_HEADER) {
    // 旧形式: 全体が単一 JSON ストア。
    var s;
    try { s = JSON.parse(raw); } catch (e2) {
      throw new Error('.vcs メタタブのJSON解析に失敗しました（手動編集の可能性）: ' + e2.message);
    }
    s.objects = s.objects || {};
    s = Ggit_migrateStore(s);
    s.__logok = false;            // 旧形式 → 次回保存で清書移行
    s.__metaSeen = 0;
    s.__persistedIds = Ggit_idSet_(s.objects);
    return s;
  }

  // 新形式: JSONL ログをリプレイ。o 行を集約し、最後の m 行を採用する。
  var store = Ggit_emptyStore();
  var metaSeen = 0;
  for (var i = 1; i < lines.length; i++) {
    var ln = lines[i];
    if (!ln) continue;
    var rec;
    try { rec = JSON.parse(ln); } catch (e3) { continue; } // 破損行スキップ
    if (rec.o) {
      store.objects[rec.o] = rec.v;
    } else if (rec.m) {
      store.version = rec.version || store.version;
      store.gen = rec.gen || 0;
      store.bookmarks = rec.bookmarks || {};
      store.working = (rec.working !== undefined) ? rec.working : null;
      metaSeen++;
    }
  }
  store = Ggit_migrateStore(store);
  store.__logok = true;
  store.__metaSeen = metaSeen;
  store.__persistedIds = Ggit_idSet_(store.objects);
  return store;
}

/**
 * タブストアとバックアップストアから採用するストアを決定する（純粋関数）。
 *  - 両方 null   → 空ストア。
 *  - 片方のみ    → 在る方。
 *  - 両方存在    → gen の大きい方（同点はタブを優先）。
 * backup.gen > tab.gen はネイティブ版復元によるタブ巻き戻しのシグナル。
 */
function Ggit_pickStore(tabStore, backupStore) {
  if (!tabStore && !backupStore) return Ggit_emptyStore();
  if (!backupStore) return tabStore;
  if (!tabStore) return backupStore;
  return ((backupStore.gen || 0) > (tabStore.gen || 0)) ? backupStore : tabStore;
}

/**
 * ストアをメタタブへ保存し、PropertiesService バックアップは非同期へ後送りする。
 * 冒頭で dirty ガード（保留中の差分バックアップを同期収束）を通し、世代カウンタを +1 して
 * `.vcs` タブへ追記（または清書）した後、dirty フラグを立ててバックアップ用トリガを予約する。
 * Properties への書き込みは Ggit_backupFlush（時間トリガ）が担う。
 *
 * 追記対象の新規オブジェクトは、読み込み時に控えた __persistedIds との差分から内部で判定する
 * （呼び出し側の変更は不要）。オブジェクト削除（GC）や旧形式・コンパクション時は全清書する。
 * 戻り値: { gen, warning }（warning は常に null。バックアップは非同期のため）。
 */
function Ggit_storeSave(doc, store) {
  doc = doc || DocumentApp.getActiveDocument();
  Ggit_ensureBackupFresh_(doc); // dirty ガード（保留中の差分バックアップを先に収束）
  var docId = doc.getId();
  store.gen = (store.gen || 0) + 1;

  // `.vcs` タブを一次の永続先として同期書き込み（追記 or 清書）。
  Ggit_tabPersist_(doc, docId, store);

  // Properties バックアップは非同期へ: docId 記録・dirty 化・トリガ予約。
  try {
    var props = PropertiesService.getDocumentProperties();
    if (props) {
      props.setProperty(GGIT_DOCID_KEY, docId);
      props.setProperty(GGIT_DIRTY_KEY, String(store.gen));
    }
  } catch (e) {
    Logger.log('ggit dirty 設定失敗: ' + e.message);
  }
  Ggit_scheduleBackup_();

  return { gen: store.gen, warning: null };
}

/**
 * `.vcs` タブへの永続化（追記 or 全清書）。
 * 追記条件: メタタブが既に新形式ログで、読込時の永続集合からオブジェクト削除が無く、
 * 溜まった meta 行が閾値未満。それ以外（新規・旧形式・巻き戻し採用・削除・コンパクション）は全清書。
 */
function Ggit_tabPersist_(doc, docId, store) {
  var t = Ggit_metaTab(doc);
  var persisted = store.__persistedIds;
  var added = [];
  var removed = false;
  if (persisted) {
    for (var id in store.objects) {
      if (store.objects.hasOwnProperty(id) && !persisted[id]) added.push(id);
    }
    for (var pid in persisted) {
      if (persisted.hasOwnProperty(pid) && !store.objects.hasOwnProperty(pid)) { removed = true; break; }
    }
  }
  var canAppend = !!t && store.__logok === true && !!persisted && !removed &&
    (store.__metaSeen || 0) < GGIT_COMPACT_INTERVAL;
  if (!t) t = Ggit_createTab(doc, GGIT_META_TITLE);

  if (canAppend) {
    Ggit_appendTabTextApi(docId, t.getId(), Ggit_logAppend_(store, added));
    store.__metaSeen = (store.__metaSeen || 0) + 1;
  } else {
    Ggit_setTabTextApi(docId, t.getId(), Ggit_logRewrite_(store));
    store.__logok = true;
    store.__metaSeen = 1;
  }
  store.__persistedIds = Ggit_idSet_(store.objects);
}

/** ログのヘッダ行。 */
function Ggit_logHeaderLine_(store) {
  return JSON.stringify({ h: GGIT_LOG_HEADER, version: store.version || 3 });
}

/** ログの meta 行（最新の version/gen/bookmarks/working）。 */
function Ggit_logMetaLine_(store) {
  return JSON.stringify({
    m: 1, version: store.version || 3, gen: store.gen || 0,
    bookmarks: store.bookmarks || {}, working: store.working || null
  });
}

/** ストア全体を JSONL ログ文字列へ清書する（ヘッダ＋全オブジェクト＋単一 meta）。 */
function Ggit_logRewrite_(store) {
  var lines = [Ggit_logHeaderLine_(store)];
  for (var id in store.objects) {
    if (store.objects.hasOwnProperty(id)) {
      lines.push(JSON.stringify({ o: id, v: store.objects[id] }));
    }
  }
  lines.push(Ggit_logMetaLine_(store));
  return lines.join('\n');
}

/** 末尾へ追記する文字列（先頭改行＋新オブジェクト行＋meta 行）を生成する。 */
function Ggit_logAppend_(store, newObjectIds) {
  var lines = [];
  for (var i = 0; i < newObjectIds.length; i++) {
    var id = newObjectIds[i];
    var o = store.objects[id];
    if (o) lines.push(JSON.stringify({ o: id, v: o }));
  }
  lines.push(Ggit_logMetaLine_(store));
  return '\n' + lines.join('\n');
}

/* ===================== PropertiesService バックアップ（差分追記） ===================== */

/**
 * ストアを Properties へ差分追記する。既に存在するオブジェクト（不変）は再書き込みせず、
 * 未保存のオブジェクトのみ ggit.o.<id> へ書き、meta を更新する。全削除は行わない。
 * 容量超過などで失敗した場合は throw せず警告文字列を返す（best-effort）。成功時は null。
 */
function Ggit_backupSave(doc, store) {
  try {
    var props = PropertiesService.getDocumentProperties();
    if (!props) return 'バックアップ不可（DocumentProperties が利用できません）。';

    var existing = Ggit_backupObjIds_(props);
    var map = {};
    var pending = 0;
    for (var id in store.objects) {
      if (!store.objects.hasOwnProperty(id)) continue;
      if (existing[id]) continue; // 既存は不変 → 再書き込み不要
      Ggit_propPutObj_(map, id, store.objects[id]);
      if (++pending >= GGIT_BK_BATCH) { props.setProperties(map); map = {}; pending = 0; }
    }
    map[GGIT_META_KEY] = Ggit_backupMetaStr_(store);
    props.setProperties(map);

    Ggit_backupPurgeLegacy_(props); // 旧 ggit.bk.* の残骸を移行掃除
    props.deleteProperty(GGIT_ERR_KEY);
    return null;
  } catch (e) {
    Logger.log('ggit backup 失敗（履歴本体はタブに保存済み）: ' + e.message);
    try { PropertiesService.getDocumentProperties().setProperty(GGIT_ERR_KEY, e.message); } catch (_) {}
    return 'PropertiesService バックアップに失敗しました（容量上限の可能性）。' +
      'タブには保存済みですが、ネイティブ版復元への耐性は今回縮退します: ' + e.message;
  }
}

/** Properties の meta 文字列（version/gen/bookmarks/working）。 */
function Ggit_backupMetaStr_(store) {
  return JSON.stringify({
    version: store.version || 3, gen: store.gen || 0,
    bookmarks: store.bookmarks || {}, working: store.working || null
  });
}

/** DocumentProperties のバックアップからストアを復元する（無ければ null）。新旧両対応。 */
function Ggit_backupLoad(doc) {
  try {
    var props = PropertiesService.getDocumentProperties();
    if (!props) return null;
    var metaRaw = props.getProperty(GGIT_META_KEY);
    if (!metaRaw) return Ggit_backupLoadLegacy_(props); // 旧形式フォールバック

    var meta = JSON.parse(metaRaw);
    var store = Ggit_emptyStore();
    store.version = meta.version || 3;
    store.gen = meta.gen || 0;
    store.bookmarks = meta.bookmarks || {};
    store.working = (meta.working !== undefined) ? meta.working : null;
    var ids = Ggit_backupObjIds_(props);
    for (var id in ids) {
      if (!ids.hasOwnProperty(id)) continue;
      var obj = Ggit_propGetObj_(props, id);
      if (obj) store.objects[id] = obj;
    }
    return Ggit_migrateStore(store);
  } catch (e) {
    Logger.log('ggit backup 読込失敗: ' + e.message);
    return null;
  }
}

/** 旧形式（ggit.bk.count + ggit.bk.<i>）からストアを復元する（後方互換）。 */
function Ggit_backupLoadLegacy_(props) {
  var countStr = props.getProperty('ggit.bk.count');
  if (!countStr) return null;
  var count = parseInt(countStr, 10);
  if (!(count > 0)) return null;
  var parts = [];
  for (var i = 0; i < count; i++) {
    var c = props.getProperty(GGIT_BK_PREFIX + i);
    if (c == null) return null;
    parts.push(c);
  }
  var s = JSON.parse(Ggit_gunzipB64(parts.join('')));
  s.objects = s.objects || {};
  return Ggit_migrateStore(s);
}

/** バックアップ済みオブジェクトIDの集合（ggit.o.<id>.n キーから抽出）。 */
function Ggit_backupObjIds_(props) {
  var out = {};
  var keys = props.getKeys();
  var plen = GGIT_OBJ_PREFIX.length;
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k.indexOf(GGIT_OBJ_PREFIX) === 0 && k.length > plen + 2 &&
      k.substring(k.length - 2) === '.n') {
      out[k.substring(plen, k.length - 2)] = true;
    }
  }
  return out;
}

/** 1オブジェクトを gzip+Base64 圧縮し、チャンク群として map へ積む（ggit.o.<id>.n / .<i>）。 */
function Ggit_propPutObj_(map, id, obj) {
  var payload = Ggit_gzipB64(JSON.stringify(obj));
  var chunks = Ggit_chunk(payload, GGIT_BK_CHUNK);
  map[GGIT_OBJ_PREFIX + id + '.n'] = String(chunks.length);
  for (var i = 0; i < chunks.length; i++) map[GGIT_OBJ_PREFIX + id + '.' + i] = chunks[i];
}

/** ggit.o.<id> のチャンク群を結合・復号してオブジェクトへ戻す（欠損時 null）。 */
function Ggit_propGetObj_(props, id) {
  var nStr = props.getProperty(GGIT_OBJ_PREFIX + id + '.n');
  if (!nStr) return null;
  var n = parseInt(nStr, 10);
  var parts = [];
  for (var i = 0; i < n; i++) {
    var c = props.getProperty(GGIT_OBJ_PREFIX + id + '.' + i);
    if (c == null) return null;
    parts.push(c);
  }
  return JSON.parse(Ggit_gunzipB64(parts.join('')));
}

/** 旧形式キー（ggit.bk.*）を削除する（新形式へ移行済みなら残骸掃除）。 */
function Ggit_backupPurgeLegacy_(props) {
  var keys = props.getKeys();
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].indexOf(GGIT_BK_PREFIX) === 0) props.deleteProperty(keys[i]);
  }
}

/** バックアップの現在の使用バイト数（Base64 圧縮後の総文字数）。無ければ 0。 */
function Ggit_backupBytes(doc) {
  try {
    var props = PropertiesService.getDocumentProperties();
    if (!props) return 0;
    var keys = props.getKeys();
    var total = 0;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.indexOf(GGIT_OBJ_PREFIX) === 0 || k === GGIT_META_KEY ||
        k.indexOf(GGIT_BK_PREFIX) === 0) {
        var v = props.getProperty(k);
        if (v) total += v.length;
      }
    }
    return total;
  } catch (e) {
    return 0;
  }
}

/** 文字列を size 文字ごとのチャンク配列へ分割する（純粋関数）。 */
function Ggit_chunk(str, size) {
  var out = [];
  for (var i = 0; i < str.length; i += size) out.push(str.substring(i, i + size));
  return out;
}

/* ===================== 非同期バックアップ / 収束 / dirty ガード ===================== */

/** 保留中のバックアップがあるか（dirty フラグ）。 */
function Ggit_isDirty_() {
  try {
    var props = PropertiesService.getDocumentProperties();
    return !!(props && props.getProperty(GGIT_DIRTY_KEY));
  } catch (e) {
    return false;
  }
}

/**
 * バックアップ用の時間ベース一回限りトリガを冪等に予約する。
 * 既に同名トリガがあれば何もしない（トリガ上限・重複発火を避ける）。
 */
function Ggit_scheduleBackup_() {
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === GGIT_BACKUP_TRIGGER) return;
    }
    ScriptApp.newTrigger(GGIT_BACKUP_TRIGGER).timeBased().after(1).create();
  } catch (e) {
    Logger.log('ggit バックアップトリガ予約失敗: ' + e.message);
  }
}

/** バックアップ用トリガを全削除する（後始末）。 */
function Ggit_clearBackupTriggers_() {
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === GGIT_BACKUP_TRIGGER) {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
  } catch (e) {
    Logger.log('ggit トリガ削除失敗: ' + e.message);
  }
}

/**
 * 非同期バックアップのトリガ実行関数（引数なし・トップレベル）。
 * 時間トリガには activeDocument が無いため、保存しておいた docId から openById する。
 * DocumentLock 下でストアを収束させ、自分のトリガを後始末する。
 */
function Ggit_backupFlush() {
  var props;
  try { props = PropertiesService.getDocumentProperties(); } catch (e) { return; }
  var docId = props ? props.getProperty(GGIT_DOCID_KEY) : null;
  if (!docId) { Ggit_clearBackupTriggers_(); return; }

  var lock = LockService.getDocumentLock();
  var got = false;
  try { got = lock.tryLock(10000); } catch (e) { got = false; }
  if (got) {
    try {
      Ggit_convergeStores_(DocumentApp.openById(docId));
    } catch (e) {
      Logger.log('ggit backupFlush 失敗: ' + e.message);
    } finally {
      try { lock.releaseLock(); } catch (_) {}
    }
  }
  // ロックが取れなかった場合は他（ユーザ操作のガード）が収束を担うため、トリガは後始末する。
  Ggit_clearBackupTriggers_();
}

/**
 * `.vcs` タブと Properties バックアップを世代の新しい方へ収束させる。
 *  - 巻き戻し（backup.gen > tab.gen）ならタブを採用ストアからヒール（全清書）。
 *  - 採用ストアの未保存オブジェクトを Properties へ差分追記し、meta を更新。
 *  - dirty フラグを解除する。
 * バックグラウンドフラッシュ・dirty ガード・整合性チェックの共通中核。
 */
function Ggit_convergeStores_(doc) {
  doc = doc || DocumentApp.getActiveDocument();
  var docId = doc.getId();
  var tabStore = Ggit_tabStoreLoad(doc);
  var backupStore = Ggit_backupLoad(doc);
  var tabGen = tabStore ? (tabStore.gen || 0) : null;
  var bkGen = backupStore ? (backupStore.gen || 0) : null;
  var pick = Ggit_pickStore(tabStore, backupStore);

  // タブが古い（または存在しない）＝巻き戻しシグナル → 採用ストアでタブをヒール。
  var healedTab = false;
  if (!tabStore || (backupStore && bkGen > tabGen)) {
    var t = Ggit_metaTab(doc) || Ggit_createTab(doc, GGIT_META_TITLE);
    Ggit_setTabTextApi(docId, t.getId(), Ggit_logRewrite_(pick));
    healedTab = true;
  }

  var warning = Ggit_backupSave(doc, pick);

  try { PropertiesService.getDocumentProperties().deleteProperty(GGIT_DIRTY_KEY); } catch (_) {}

  return {
    tabGen: tabGen, bkGen: bkGen, pickGen: pick.gen || 0,
    healedTab: healedTab, warning: warning
  };
}

/**
 * dirty（保留中バックアップ）なら、保存に先立って同期的に収束させる。
 * Ggit_storeSave 冒頭で呼ぶ dirty ガード。バックグラウンドが処理中でロックが取れない場合は、
 * その処理が収束を担うため続行する。
 */
function Ggit_ensureBackupFresh_(doc) {
  if (!Ggit_isDirty_()) return;
  var lock = LockService.getDocumentLock();
  try { lock.waitLock(15000); } catch (e) { return; }
  try {
    Ggit_convergeStores_(doc);
    Ggit_clearBackupTriggers_();
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/**
 * `.vcs` タブと Properties バックアップを現状に即して清書（コンパクション）する。
 *  - 採用ストア（新しい方）を基準に `.vcs` を単一 meta の JSONL へ collapse。
 *  - Properties を孤立キーごと一掃し、現行オブジェクト＋meta で再構成。
 * メニュー「圧縮 / 清書」から呼ぶ。{ gen, objects, bytes } を返す。
 */
function Ggit_compact() {
  var doc = DocumentApp.getActiveDocument();
  var docId = doc.getId();
  var lock = LockService.getDocumentLock();
  try { lock.waitLock(20000); } catch (e) {
    throw new Error('他の処理が実行中です。少し待って再実行してください。');
  }
  try {
    var pick = Ggit_pickStore(Ggit_tabStoreLoad(doc), Ggit_backupLoad(doc));

    var t = Ggit_metaTab(doc) || Ggit_createTab(doc, GGIT_META_TITLE);
    Ggit_setTabTextApi(docId, t.getId(), Ggit_logRewrite_(pick));
    Ggit_backupRewrite_(pick);

    try { PropertiesService.getDocumentProperties().deleteProperty(GGIT_DIRTY_KEY); } catch (_) {}
    Ggit_clearBackupTriggers_();

    var n = 0;
    for (var id in pick.objects) { if (pick.objects.hasOwnProperty(id)) n++; }
    return { gen: pick.gen || 0, objects: n, bytes: Ggit_backupBytes(doc) };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/** Properties を全削除してから現行ストアで再構成する（清書用）。 */
function Ggit_backupRewrite_(store) {
  var props = PropertiesService.getDocumentProperties();
  if (!props) return;
  var keys = props.getKeys();
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k.indexOf(GGIT_OBJ_PREFIX) === 0 || k.indexOf(GGIT_BK_PREFIX) === 0) {
      props.deleteProperty(k);
    }
  }
  var map = {};
  var pending = 0;
  for (var id in store.objects) {
    if (!store.objects.hasOwnProperty(id)) continue;
    Ggit_propPutObj_(map, id, store.objects[id]);
    if (++pending >= GGIT_BK_BATCH) { props.setProperties(map); map = {}; pending = 0; }
  }
  map[GGIT_META_KEY] = Ggit_backupMetaStr_(store);
  props.setProperties(map);
  props.deleteProperty(GGIT_ERR_KEY);
}

/** `.vcs` メタタブが存在するか（＝初期化済みか）。 */
function Ggit_isInitialized(doc) {
  return !!Ggit_metaTab(doc || DocumentApp.getActiveDocument());
}

/**
 * 初期化（権限付与）— これ「だけ」で初回セットアップを完結させる。
 *
 * onOpen は AuthMode.NONE で動くため、初回の本格操作（commit 等）で認可ダイアログが出ると、
 * その関数は再実行されずに中断される。そこで初回はまず本関数で (1) 必要スコープに触れて認可を
 * 済ませ、(2) 空ストアの `.vcs` メタタブを作るところまでやって終わる。以降、commit などは
 * 「`.vcs` を新規生成する」副作用を持たずに済む（＝初回コミットでの生成競合・認可中断が起きない）。
 *
 * 既に初期化済み（`.vcs` あり）なら作成はスキップする。戻り値: { created, title, tabCount }。
 */
function Ggit_setup() {
  var doc = DocumentApp.getActiveDocument();
  try { Session.getActiveUser().getEmail(); } catch (_) {}                 // userinfo.email スコープに触れる
  try { People.People.get('people/me', { personFields: 'names' }); } catch (_) {} // userinfo.profile（People）に触れる
  try { ScriptApp.getProjectTriggers(); } catch (_) {}                     // script.scriptapp（非同期バックアップのトリガ）に触れる
  var existed = Ggit_isInitialized(doc);
  if (!existed) {
    Ggit_storeSave(doc, Ggit_emptyStore()); // `.vcs` を空ストアで生成（Docs API 書き込み）
  }
  var tabs = Ggit_allTabs(doc);
  return { created: !existed, title: doc.getName(), tabCount: tabs.length };
}

/**
 * 旧スキーマを最新（version 3: Jujutsu 流ブックマークモデル）へ移行する。純粋関数。
 *  - version 1（branches が <tabId>:{head,name}）→ まず branches を <branchName>:<headCommitId> へ正規化。
 *  - version 2（branches/head/stashes[]）→ branches を bookmarks へ、head を working（コミットID）へ、
 *    stashes[] 各要素を stash:true のコミットへ変換して objects に投入する。
 * 既に version 3 のストアはそのまま返す（working 欠落時のみ補う）。
 */
function Ggit_migrateStore(s) {
  if (s.version >= 3) {
    if (s.working === undefined) s.working = null;
    s.bookmarks = s.bookmarks || {};
    if (s.gen === undefined) s.gen = 0;
    return s;
  }

  // --- v1 → v2 相当: branches を <branchName>:<headCommitId> へ正規化 ---
  var branches = {};
  for (var k in s.branches) {
    if (!s.branches.hasOwnProperty(k)) continue;
    var v = s.branches[k];
    if (v && typeof v === 'object' && v.head !== undefined) {
      var name = v.name || k;                       // タブ名（無ければ tabId）を採用
      var base = name, i = 2;
      while (branches.hasOwnProperty(name)) { name = base + '-' + i; i++; } // 同名は連番で一意化
      branches[name] = v.head;
    } else {
      branches[k] = v;                              // 既に文字列 HEAD
    }
  }

  // --- v2 → v3: branches→bookmarks、head→working、stashes[]→stash コミット ---
  s.bookmarks = branches;
  s.working = (s.head && branches.hasOwnProperty(s.head)) ? branches[s.head] : null;

  var stashes = s.stashes || [];
  for (var j = 0; j < stashes.length; j++) {
    var st = stashes[j];
    if (!st || !st.data) continue;
    var parent = (st.branchName && branches.hasOwnProperty(st.branchName))
      ? branches[st.branchName] : null;
    var id = st.id;
    while (s.objects.hasOwnProperty(id)) id = id + 'x';   // 既存IDと衝突しないようにする
    s.objects[id] = {
      id: id, parent: parent, parent2: null,
      message: st.message || 'スタッシュ（移行）',
      author: st.author || 'unknown',
      timestamp: st.timestamp || '',
      payload: { type: 'full', data: st.data },           // st.data は gzip+Base64 のスナップショット
      stash: true
    };
  }

  delete s.branches;
  delete s.head;
  delete s.stashes;
  s.version = 3;
  if (s.gen === undefined) s.gen = 0;
  return s;
}

/**
 * 現在地 working（コミットID）を解決する。store.working が有効な object を指せばそれを返す。
 * 未設定（または無効）なら null。jj では working は名前ではなくコミットID。
 */
function Ggit_resolveWorking(doc, store) {
  if (store.working && store.objects.hasOwnProperty(store.working)) return store.working;
  return null;
}

// ----- File: src/Tabs.js -----
/**
 * Tabs.js — タブ走査・本文 get/set ヘルパー。
 *
 * Google ドキュメントのタブは木構造（親タブ／子タブ）を成す。本モジュールは
 * 全タブを再帰的に平坦化して扱うためのユーティリティを提供する。
 *
 * 参照: 設計仕様書 §4.2「タブ操作のAPI前提」。
 */

/** 全タブ（子タブ含む）を平坦な配列で返す。 */
function Ggit_allTabs(doc) {
  doc = doc || DocumentApp.getActiveDocument();
  var out = [];
  function rec(tabs) {
    for (var i = 0; i < tabs.length; i++) {
      out.push(tabs[i]);
      rec(tabs[i].getChildTabs());
    }
  }
  rec(doc.getTabs());
  return out;
}

/** タブIDから Tab を引く。見つからなければ null。 */
function Ggit_tabById(doc, id) {
  var all = Ggit_allTabs(doc);
  for (var i = 0; i < all.length; i++) {
    if (all[i].getId() === id) return all[i];
  }
  return null;
}

/** タブ本文のプレーンテキストを取得。 */
function Ggit_tabText(tab) {
  return tab.asDocumentTab().getBody().getText();
}

/** タブ本文をプレーンテキストで上書き。 */
function Ggit_setTabText(tab, text) {
  tab.asDocumentTab().getBody().setText(text);
}

/**
 * Docs API 経由でタブ本文をプレーンテキストで上書きする。
 *
 * `Ggit_setTabText`（DocumentApp）は、`Ggit_createTab` が `openById` で開いた
 * 「2つ目のライブインスタンス」のタブに書くと、実行終了時のフラッシュ競合で
 * 書き込みが失われることがある（新規タブ本文や `.vcs` 生成時に顕在化）。
 * 本関数は DocumentApp を介さず Docs API で書くため、その競合を回避する。
 *
 * 既存本文を deleteContentRange で削除してから insertText する。本文末尾の改行は
 * 削除できないため範囲は `endIndex - 1` まで。すべての Location/Range には対象タブを
 * 指す `tabId` を付与する。
 */
function Ggit_setTabTextApi(docId, tabId, text) {
  var docRes = Docs.Documents.get(docId, {
    includeTabsContent: true,
    fields: 'tabs(tabProperties/tabId,childTabs,documentTab(body(content(endIndex))))'
  });
  var endIndex = Ggit_tabBodyEndIndex_(docRes, tabId);

  var requests = [];
  // 既存本文（index 1 .. endIndex-1）を削除。末尾改行のみ（endIndex<=2）なら何もしない。
  if (endIndex > 2) {
    requests.push({
      deleteContentRange: {
        range: { startIndex: 1, endIndex: endIndex - 1, tabId: tabId }
      }
    });
  }
  // 新本文を本文先頭（index 1）へ挿入。
  if (text && text.length) {
    requests.push({
      insertText: { location: { index: 1, tabId: tabId }, text: text }
    });
  }
  if (requests.length) {
    Docs.Documents.batchUpdate({ requests: requests }, docId);
  }
}

/**
 * Docs.Documents.get レスポンスから、指定タブの本文末尾 index を求める。
 * タブ木（childTabs）を再帰的に辿って tabProperties.tabId 一致タブを探し、その
 * documentTab.body.content 末尾要素の endIndex を返す。空本文時は 1 を返す。
 * 注: Docs API の Tab はタブIDを最上位ではなく tabProperties.tabId に持つ。
 */
function Ggit_tabBodyEndIndex_(docRes, tabId) {
  var found = null;
  (function rec(tabs) {
    if (!tabs) return;
    for (var i = 0; i < tabs.length; i++) {
      if (found) return;
      var tp = tabs[i].tabProperties;
      if (tp && tp.tabId === tabId) { found = tabs[i]; return; }
      rec(tabs[i].childTabs);
    }
  })(docRes.tabs);

  if (!found || !found.documentTab || !found.documentTab.body ||
      !found.documentTab.body.content) {
    throw new Error('Docs API レスポンスから対象タブの本文を特定できませんでした: ' + tabId);
  }
  var content = found.documentTab.body.content;
  var last = content[content.length - 1];
  return (last && last.endIndex) ? last.endIndex : 1;
}

/**
 * Docs API 経由でタブ本文末尾へテキストを追記する（削除を伴わない単一リクエスト）。
 *
 * `.vcs` 追記型ログ（JSONL）の通常保存で用いる。本文を全置換する `Ggit_setTabTextApi`
 * と異なり、既存内容を残したまま末尾に挿入するため書き込みコストが O(追記分) で済む。
 * 末尾の暗黙改行の手前（endIndex - 1）へ挿入する。空本文時は index 1 へ挿入する。
 */
function Ggit_appendTabTextApi(docId, tabId, text) {
  if (!text || !text.length) return;
  var docRes = Docs.Documents.get(docId, {
    includeTabsContent: true,
    fields: 'tabs(tabProperties/tabId,childTabs,documentTab(body(content(endIndex))))'
  });
  var endIndex = Ggit_tabBodyEndIndex_(docRes, tabId);
  var at = (endIndex > 1) ? endIndex - 1 : 1; // 末尾改行の手前（空本文は 1）
  Docs.Documents.batchUpdate({
    requests: [{ insertText: { location: { index: at, tabId: tabId }, text: text } }]
  }, docId);
}

/** Docs API のドキュメントから全タブID（子タブ含む）を平坦に集める。 */
function Ggit_docsTabIds(docId) {
  var docRes = Docs.Documents.get(docId, { includeTabsContent: false });
  var ids = [];
  function rec(tabs) {
    if (!tabs) return;
    for (var i = 0; i < tabs.length; i++) {
      var tp = tabs[i].tabProperties;
      if (tp && tp.tabId) ids.push(tp.tabId);
      rec(tabs[i].childTabs);
    }
  }
  rec(docRes.tabs);
  return ids;
}

/**
 * Docs 拡張サービス経由で新規ドキュメントタブを生成し、生成された Tab を返す。
 *
 * `DocumentApp` 本体にタブ追加メソッドは無いため、Docs API の batchUpdate
 * （addDocumentTab）を用いる（設計仕様書 §4.2）。
 *
 * 新タブの特定は二段構えで行う:
 *  1) batchUpdate と同じバックエンド（強整合）の Docs API で生成前後のタブID差分を取り、
 *     新タブIDを確定する（レスポンス形状に依存しない）。
 *  2) Docs API の書き込みが DocumentApp 側へ反映されるまで遅延し得るため、
 *     反映を待ちながら（リトライ）新タブの DocumentApp.Tab を取得して返す。
 */
function Ggit_createTab(doc, title) {
  var docId = doc.getId();
  var beforeIds = Ggit_docsTabIds(docId);

  try {
    Docs.Documents.batchUpdate(
      { requests: [{ addDocumentTab: { tabProperties: { title: title } } }] },
      docId
    );
  } catch (e) {
    throw new Error(
      'タブ生成に失敗しました（addDocumentTab）。Docs 拡張サービスの有効化と、' +
      '対象ドキュメントのタブAPI対応状況を確認してください。詳細: ' + e.message
    );
  }

  // 1) Docs API（強整合）で新タブIDを確定する。
  var newId = null;
  var afterIds = Ggit_docsTabIds(docId);
  for (var i = 0; i < afterIds.length; i++) {
    if (beforeIds.indexOf(afterIds[i]) === -1) { newId = afterIds[i]; break; }
  }

  // 2) DocumentApp 側へ反映されるまで待って Tab を取得する。
  //    （openById は実行内キャッシュ／反映遅延の影響を受けるため、開き直しつつ待機する）
  for (var attempt = 0; attempt < 6; attempt++) {
    var fresh = DocumentApp.openById(docId);
    var after = Ggit_allTabs(fresh);
    if (newId) {
      for (var k = 0; k < after.length; k++) {
        if (after[k].getId() === newId) return after[k];
      }
    } else {
      // newId 不明時のフォールバック: 同名タブ（末尾優先）。
      for (var j = after.length - 1; j >= 0; j--) {
        if (after[j].getTitle() === title) return after[j];
      }
    }
    Utilities.sleep(400 * (attempt + 1)); // 0.4s,0.8s,...,2.4s（合計 ~8.4s 上限）
  }

  throw new Error(
    'タブは生成されましたが、DocumentApp 側への反映を確認できませんでした。' +
    '少し待ってからページを再読み込みし、再度お試しください。' +
    (newId ? '（新タブID: ' + newId + '）' : '')
  );
}
