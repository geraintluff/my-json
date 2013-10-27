var mysql = require('mysql');
var jsonPointer = require('json-pointer');

/* Workaround for current version of json-pointer */
jsonPointer.remove = jsonPointer.remove || function (obj, path) {
	var parts = this.parse(path);
	var finalProperty = parts.pop();
	var parent = parts.length ? this.get(obj, this.compile(parts)) : obj;
	delete parent[finalProperty];
	return this;
};

var SchemaCondition = require('./schema-condition');

function LoadError(errors, row, object) {
	this.errors = errors;
	this.row = row;
	this.object = object;
}
LoadError.prototype = new Error('Error loading value');

function Config(obj) {
	this.table = obj.table;
	this.columns = obj.columns;
	this.readOnly = obj.readOnly || {};
	this.writeOnly = obj.writeOnly || {};
	
	this.keyColumns = obj.keyColumn || obj.keyColumns || [];
	this.keyColumns = Array.isArray(this.keyColumns) ? this.keyColumns : [this.keyColumns];
	this.sqlKeyColumns = [];
	for (var i = 0; i < this.keyColumns.length; i++) {
		var column = this.keyColumns[i];
		var entry = this.columns[column] || this.readOnly[column];
		if (typeof entry === 'object') {
			this.sqlKeyColumns.push(entry.alias || column);
		} else if (typeof entry === 'string') {
			this.sqlKeyColumns.push(entry);
		} else {
			this.sqlKeyColumns.push(column);
		}
	}
	this.readColumns = Object.keys(this.columns).concat(Object.keys(this.readOnly));
	this.writeColumns = Object.keys(this.columns).concat(Object.keys(this.writeOnly));
	// Load-order: shortest first
	this.readColumns.sort(function (a, b) {
		return a.length - b.length;
	});
	// Write-order: longest first
	this.writeColumns.sort(function (a, b) {
		return b.length - a.length;
	});
	
	for (var key in this.readOnly) {
		this.columns[key] = this.columns[key] || this.readOnly[key];
	}
	for (var key in this.writeOnly) {
		this.columns[key] = this.columns[key] || this.writeOnly[key];
	}
}
Config.prototype = {
	columnForPath: function (dataPath, type) {
		var columnKey = (type || "") + dataPath;
		if (this.columns[columnKey]) {
			if (typeof this.columns[columnKey] === 'object') {
				return this.columns[columnKey].alias || columnKey;
			} else if (typeof this.columns[columnKey] === 'string') {
				return this.columns[columnKey];
			} else {
				return columnKey;
			}
		}
		return null;
	},
	deconstructColumn: function (column, useAliases) {
		if (useAliases !== false) {
			for (var key in this.columns) {
				if (this.columns[key] === column) {
					column = key;
					break;
				} else if (typeof this.columns[key] === 'object' && this.columns[key].alias === column) {
					column = key;
				}
			}
		}
		var type = column.split('/', 1)[0];
		var dataPath = column.substring(type.length);
		return {
			type: type,
			path: dataPath
		}
	}
};

function createClass(config, constructor, proto) {
	if (!(config instanceof Config)) {
		config = new Config(config);
	}
	if (!proto && typeof constructor === 'object') {
		proto = constructor;
		constructor = undefined;
	}
	// TODO: use tv4 to validate config
	var escapedTable = mysql.escapeId(config.table);
	var initialTableName = "";
	config.table.replace(/([A-Z])/g, function(letter) {return "_"+letter.toLowerCase();}).replace(/[^a-z_0-9]/g, '_').replace(/^_*/, '').replace(/_*$/, '').split('_').forEach(function (entry) {
		initialTableName += entry.charAt(0);
	});

	var NewClass;
	if (constructor) {
		NewClass = function () {
			var _super = {};
			for (var key in proto) {
				_super[key] = proto[key].bind(this);
			}
			var args = [];
			while (args.length < arguments.length) {
				args[args.length] = arguments.length;
			}
			args.unshift(_super);
			return constructor.apply(this, args);
		}
	} else {
		NewClass = function () {};
	}
	NewClass.prototype = proto || {};
	
	function normaliseKeyValues(keyValues) {
		var newKeyValues = [];
		if (keyValues.length !== config.keyColumns.length) {
			throw new Error('Expected ' + config.keyColumns.length + ' key columns, only got ' + keyValues.length);
		}
		for (var i = 0; i < keyValues.length; i++) {
			var value = keyValues[i];
			var key = config.deconstructColumn(config.keyColumns[i]);
			if ((key.type === 'integer' || key.type === 'number') && typeof value !== 'number') {
				value = parseFloat(value, 10);
				if (isNaN(value)) {
					throw new Error('Key value must be number: ' + keyValues[i]);
				}
			} else if (key.type === 'string') {
				value = "" + value;
			}
			newKeyValues[i] = value;
		}
		return newKeyValues;
	}
	function schemaForKeyValues(keyValues) {
		var schema = {};
		for (var i = 0; i < keyValues.length; i++) {
			var value = keyValues[i];
			var key = config.deconstructColumn(config.keyColumns[i]);
			
			var parts = jsonPointer.parse(key.path);
			var targetSchema = schema;
			for (var j = 0; j < parts.length; j++) {
				var part = parts[j];
				targetSchema.type = 'object';
				targetSchema.properties = targetSchema.properties || {};
				targetSchema.properties[part] = {};
				targetSchema = targetSchema.properties[part];
			}
			targetSchema['enum'] = [value];
		}
		return schema;
	}
	
	var staticMethods = {
		sqlFromSchema: function (schema) {
			var condition = SchemaCondition.fromSchema(schema, config);
			var table = initialTableName;
			return 'SELECT ' + table + '.*\n\tFROM ' + escapedTable + ' ' + table + '\n\tWHERE ' + condition.sqlWhere(table, false, '\t').replace(/\n/g, '\n\t');
		},
		openMultiple: function (connection, map, callback) {
			if (Array.isArray(map)) {
				// Create an object equivalent, and convert back to an array afterwards
				var newMap = {};
				for (var i = 0; i < map.length; i++) {
					newMap[i] = map[i];
				}
				return staticMethods.openMultiple.call(this, connection, newMap, function (err, result) {
					var arrayResult = [];
					for (var i = 0; i < map.length; i++) {
						arrayResult[i] = result[i];
					}
					callback(null, arrayResult);
				});
			}
			var thisClass = this;
			var schema = {anyOf: []};
			var resultsKeys = {};
			for (var mapKey in map) {
				var keyValues = Array.isArray(map[mapKey]) ? map[mapKey] : [map[mapKey]];
				var newKeyValues = normaliseKeyValues(keyValues);
				resultsKeys[mapKey] = JSON.stringify(newKeyValues);
				schema.anyOf.push(schemaForKeyValues(newKeyValues));
			}
			staticMethods.search.call(this, connection, schema, function (err, results) {
				if (err) {
					return callback(err);
				}
				var resultsMap = {};
				for (var resultNumber = 0; resultNumber < results.length; resultNumber++) {
					var obj = results[resultNumber];
					var key = [];
					for (var i = 0; i < config.keyColumns.length; i++) {
						var splitKey = config.deconstructColumn(config.keyColumns[i]);
						key[i] = jsonPointer.get(obj, splitKey.path);
					}
					var keyJson = JSON.stringify(key); // all scalar values, so this is deterministic
					resultsMap[keyJson] = obj;
				}
				var result = {};
				for (var key in resultsKeys) {
					result[key] = resultsMap[resultsKeys[key]];
				}
				callback(null, result);
			});
		},
		open: function (connection) {
			var callback = arguments[arguments.length - 1];
			var keyValues = Array.prototype.slice.call(arguments, 1, arguments.length - 1);
			return staticMethods.openMultiple.call(this, connection, {single: keyValues}, function (err, results) {
				if (err) {
					return callback(err);
				}
				callback(null, results.single);
			});
		},
		search:  function (connection, schema, callback) {
			var thisClass = this;
			var sql = this.sqlFromSchema(schema);
			connection.query(sql, function (error, results) {
				if (error) {
					return callback(error);
				}
				for (var i = 0; i < results.length; i++) {
					results[i] = thisClass.fromRow(results[i]);
				}
				callback(null, results);
			});
			return this;
		},
		save: function (connection, obj, forceInsert, callback) {
			var thisClass = this;
			if (typeof forceInsert === 'function') {
				callback = forceInsert;
				forceInsert = undefined;
			}
			try {
				var remainderObject = JSON.parse(JSON.stringify(obj)); // Copy, and also ensure it's JSON-friendly
			} catch (e) {
				console.log(obj);
				console.log(JSON.stringify(obj));
			}
			var updateObj = {};
			var wherePairs = [];
			var missingKeyColumns = [];
			// Longest first
			for (var i = 0; i < config.writeColumns.length; i++) {
				var column = config.writeColumns[i];
				var isKeyColumn = config.keyColumns.indexOf(column) !== -1;
				var key = config.deconstructColumn(column, false);
				var alias = config.columnForPath(key.path, key.type);
				if (!jsonPointer.has(obj, key.path) || typeof (value = jsonPointer.get(obj, key.path)) === 'undefined') {
					if (isKeyColumn && !forceInsert) {
						missingKeyColumns.push(column);
					} else {
						updateObj[alias] = null;
					}
					continue;
				}
				var value = jsonPointer.get(remainderObject, key.path);
				jsonPointer.set(remainderObject, key.path, undefined);
				if (key.type === 'boolean') {
					if (typeof value === 'boolean') {
						value = value ? 1 : 0;
					} else {
						value = null;
					}
				} else if (key.type === 'integer') {
					if (typeof value !== 'number' || Math.floor(value) !== value) {
						value = null;
					}
				} else if (key.type === 'number') {
					if (typeof value !== 'number') {
						value = null;
					}
				} else if (key.type === 'string') {
					if (typeof value !== 'string') {
						value = null;
					}
				} else if (key.type === 'json') {
					value = JSON.stringify(value);
				} else {
					throw new Error('Unknown column type: ' + key.type);
					continue;
				}
				if (isKeyColumn && !forceInsert) {
					var pair = mysql.escapeId(alias) + "=" + mysql.escape(value);
					wherePairs.push(pair);
				} else {
					updateObj[alias] = value;
				}
			}
			if (missingKeyColumns.length === 0 && !forceInsert) {
				var updatePairs = [];
				for (var alias in updateObj) {
					updatePairs.push(mysql.escapeId(alias) + "=" + mysql.escape(updateObj[alias]));
				}
				var sql = 'UPDATE ' + escapedTable + '\n\tSET ' + updatePairs.join(',\n\t') + '\nWHERE ' + wherePairs.join(' AND ');
				connection.query(sql, function (err, result) {
					if (err) {
						return callback(err);
					}
					if (result.affectedRows || forceInsert === false) {
						callback(null, result);
					} else {
						staticMethods.save.call(thisClass, connection, obj, true, callback);
					}
				});
			} else {
				if (missingKeyColumns.length > 1) {
					throw new Error('Cannot have more than one missing key column: ' + missingKeyColumns);
				}
				var keyColumn = null;
				if (missingKeyColumns.length === 1) {
					var keyColumn = config.deconstructColumn(missingKeyColumns[0]);
					if (keyColumn.type !== 'integer' && keyColumn.type !== 'number') {
						throw new Error('Missing key column must be number: ' + missingKeyColumns);
					}
				}
				var insertColumns = [];
				var insertValues = [];
				for (var alias in updateObj) {
					insertColumns.push(mysql.escapeId(alias));
					insertValues.push(mysql.escape(updateObj[alias]));
				}
				var sql = 'INSERT INTO ' + escapedTable + ' (' + insertColumns.join(', ') + ') VALUES (\n\t' + insertValues.join(',\n\t') + ')';
				connection.query(sql, function (err, result) {
					if (err) {
						return callback(err);
					}
					if (keyColumn) {
						jsonPointer.set(obj, keyColumn.path, result.insertId);
					}
					callback(null, result);
				});
			}
			return this;
		},
		remove: function (connection, obj, callback) {
			var updateObj = {};
			var wherePairs = [];
			var missingKeyColumns = [];
			// Longest first
			for (var i = 0; i < config.keyColumns.length; i++) {
				var column = config.keyColumns[i];
				var isKeyColumn = config.keyColumns.indexOf(column) !== -1;
				var key = config.deconstructColumn(column, false);
				var alias = config.columnForPath(key.path, key.type);
				var value;
				if (!jsonPointer.has(obj, key.path) || typeof (value = jsonPointer.get(obj, key.path)) === 'undefined') {
					throw new Error('Cannot delete object missing key columns');
				}
				if (key.type === 'boolean') {
					if (typeof value === 'boolean') {
						value = value ? 1 : 0;
					} else {
						value = null;
					}
				} else if (key.type === 'integer') {
					if (typeof value !== 'number' || Math.floor(value) !== value) {
						value = null;
					}
				} else if (key.type === 'number') {
					if (typeof value !== 'number') {
						value = null;
					}
				} else if (key.type === 'string') {
					if (typeof value !== 'string') {
						value = null;
					}
				} else if (key.type === 'json') {
					value = JSON.stringify(value);
				} else {
					throw new Error('Unknown column type: ' + key.type);
					continue;
				}
				var pair = mysql.escapeId(alias) + "=" + mysql.escape(value);
				wherePairs.push(pair);
			}
			var sql = 'DELETE FROM ' + escapedTable + ' WHERE ' + wherePairs.join(' AND ');
			connection.query(sql, function (err, result) {
				if (err) {
					return callback(err);
				}
				for (var i = 0; i < config.keyColumns.length; i++) {
					var keyColumn = config.deconstructColumn(config.keyColumns[i]);
					jsonPointer.remove(obj, keyColumn.path);
				}
				callback(null, result);
			});
			return this;
		},
		fromRow: function (row) {
			var result = new NewClass();
			var errors = [];
			for (var i = 0; i < config.readColumns.length; i++) {
				var key = config.deconstructColumn(config.readColumns[i], 'read');
				var rowKey = config.columnForPath(key.path, key.type);
				if (!Object.prototype.hasOwnProperty.call(row, rowKey)) {
					continue;
				}
				var value = row[rowKey];
				if (value === null || typeof value === 'undefined') {
					continue;
				}
				if (key.type === 'boolean') {
					value = !!value;
				} else if (key.type === 'number') {
					value = parseFloat(value);
				} else if (key.type === 'integer') {
					value = parseInt(value, 10);
				} else if (key.type === 'string') {
					value = "" + value;
				} else if (key.type === 'json') {
					try {
						value = JSON.parse(value);
					} catch (e) {
						errors.push(e);
					}
				} else {
					throw new Error('Unknown column type: ' + key.type);
				}
				if (key.path) {
					jsonPointer.set(result, key.path, value);
				} else if (typeof value === 'object' && !Array.isArray(value)) {
					for (var key in value) {
						result[key] = value[key];
					}
				} else {
					errors.push(new Error("Cannot load non-object into root value"));
				}
			}
			if (errors.length) {
				console.log(row);
				console.log(value);
				throw new Error(errors, row, value);
			}
			return result;
		},
		cacheWith: function (mysqlConnection) {
			var result = this.cache();
			result.search = result.search.bind(result, mysqlConnection);
			result.save = result.save.bind(result, mysqlConnection);
			result.remove = result.remove.bind(result, mysqlConnection);
			result.open = result.open.bind(result, mysqlConnection);
			result.openMultiple = result.openMultiple.bind(result, mysqlConnection);
			return result;
		},
		cache: function () {
			var objectCache = {};
			
			var laterOpenParams = {};
			var cacheMethods = {
				openLater: function () {
					var keyValues = normaliseKeyValues(arguments);
					var keyJson = JSON.stringify(keyValues);
					if (keyJson in objectCache) {
						return;
					}
					laterOpenParams[keyJson] = keyValues;
					return this;
				},
				openMultiple: function (connection, map, callback) {
					if (Array.isArray(map)) {
						// Create an object equivalent, and convert back to an array afterwards
						var newMap = {};
						for (var i = 0; i < map.length; i++) {
							newMap[i] = map[i];
						}
						return cacheMethods.openMultiple.call(this, connection, newMap, function (err, result) {
							var arrayResult = [];
							for (var i = 0; i < map.length; i++) {
								arrayResult[i] = result[i];
							}
							callback(null, arrayResult);
						});
					}
					var newMap = {};
					var resultsKeys = {};
					var cachedResults = {};
					for (var mapKey in map) {
						var keyValues = Array.isArray(map[mapKey]) ? map[mapKey] : [map[mapKey]];
						var newKeyValues = normaliseKeyValues(keyValues);
						var keyJson = JSON.stringify(newKeyValues);
						if (keyJson in objectCache) {
							cachedResults[mapKey] = objectCache[keyJson];
						} else {
							resultsKeys[mapKey] = keyJson;
							newMap[keyJson] = map[mapKey];
						}
					}
					if (Object.keys(newMap).length === 0) {
						return callback(null, cachedResults);
					}
					for (var key in laterOpenParams) {
						newMap[key] = laterOpenParams[key];
					}
					laterOpenParams = {};
				
					return NewClass.openMultiple.call(this, connection, newMap, function (err, results) {
						if (err) {
							return callback(err);
						}
						var newResults = {};
						for (var key in cachedResults) {
							newResults[key] = cachedResults[key];
						}
						for (var mapKey in resultsKeys) {
							newResults[mapKey] = results[resultsKeys[mapKey]];
						}
						callback(null, newResults);
					});
				},
				open: function (connection) {
					var callback = arguments[arguments.length - 1];
					var keyValues = Array.prototype.slice.call(arguments, 1, arguments.length - 1);
					return cacheMethods.openMultiple.call(this, connection, {single: keyValues}, function (err, results) {
						if (err) {
							return callback(err);
						}
						callback(null, results.single);
					});
				},
				fromRow: function (row) {
					var key = [];
					for (var i = 0; i < config.sqlKeyColumns.length; i++) {
						key[i] = row[config.sqlKeyColumns[i]];
					}
					var keyJson = JSON.stringify(key); // all scalar values, so this is deterministic
					if (keyJson === '[]') {
						// Nothing to cache, or all key columns undefined
						return NewClass.fromRow(row);
					}
					if (keyJson in objectCache) {
						return objectCache[keyJson];
					} else {
						delete laterOpenParams[keyJson];
						return objectCache[keyJson] = NewClass.fromRow(row);
					}
				}
			};

			function Cache() {
				return NewClass.apply(this, arguments);
			}
			Cache.prototype = Object.create(NewClass.prototype);
			for (var key in staticMethods) {
				Cache[key] = staticMethods[key];
			}
			for (var key in cacheMethods) {
				Cache[key] = cacheMethods[key];
			}
			
			return Cache;
		}
	}
	
	for (var key in staticMethods) {
		NewClass[key] = staticMethods[key];
	}
	
	return NewClass;
}

var publicApi = createClass;
publicApi.sqlMatchPattern = function (sql, pattern) {
	if (Array.isArray(pattern)) {
		for (var i = 0; i < pattern.length; i++) {
			if (publicApi.sqlMatchPattern(sql, pattern[i])) {	
				return true;
			}
		}
		return false;
	}

	// Normalise both SQL and pattern - convert all whitespace to single-spaces, strip space around brackets
	sql = sql.replace(/[ \t\r\n]+/g, ' ').replace(/ ?\( ?/g, '(').replace(/ ?\) ?/g, ')');
	pattern = pattern.replace(/[ \t\r\n]+/g, ' ').replace(/ ?\( ?/g, '(').replace(/ ?\) ?/g, ')');
	
	var patternSubs = {};
	while (sql.length > 0 || pattern.length > 0) {
		if (sql.charAt(0) === pattern.charAt(0)) {
			sql = sql.substring(1);
			pattern = pattern.substring(1);
		} else if (pattern.charAt(0) === '{') {
			var templateVar = pattern.match(/^[^}]*}/)[0];
			var sqlValue = sql.match(/^[a-zA-Z0-9_]*/)[0];
			if (!sqlValue) {
				return false;
			}
			pattern = pattern.substring(templateVar.length);
			sql = sql.substring(sqlValue.length);
			templateVar = templateVar.substring(1, templateVar.length - 1);

			if (typeof patternSubs[templateVar] === 'undefined') {
				patternSubs[templateVar] = sqlValue;
			} else if (patternSubs[templateVar] !== sqlValue) {
				return false;
			}
		} else {
			return false;
		}
	}
	return true;
};
// Not a general-purpose fake - just enough to cover everything MyJSON uses
function FakeConnection (queryMethod) {
	if (!(this instanceof FakeConnection)) {
		return new FakeConnection(queryMethod);
	}
	this.query = function (sql, inserts, callback) {
		if (typeof inserts === 'function') {
			return queryMethod.call(this, sql, function (err, results) {
				inserts(err, results || {affectedRows: 1});
			});
		}
		sql = mysql.format(sql, inserts);
		return queryMethod.call(this, sql, function (err, results) {
			callback(err, results || {affectedRows: 1});
		});
	}
};
publicApi.FakeConnection = FakeConnection;

function ClassGroup(configs) {
	if (!(this instanceof ClassGroup)) {
		return new ClassGroup(configs);
	}
	this.addClass = function (key, config) {
		this[key] = createClass(config);
	};
	for (var key in configs) {
		this.addClass(key, configs[key]);
	}
}
ClassGroup.prototype = {};

publicApi.group = ClassGroup;

module.exports = publicApi;