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
	this.keyColumns = (obj.keyColumn ? [obj.keyColumn] : obj.keyColumns) || [];
	this.sqlKeyColumns = [];
	for (var i = 0; i < this.keyColumns.length; i++) {
		var column = this.keyColumns[i];
		if (typeof this.columns[column] === 'object') {
			this.sqlKeyColumns.push(this.columns[column].alias || column);
		} else if (typeof this.columns[column] === 'string') {
			this.sqlKeyColumns.push(this.columns[column]);
		} else {
			this.sqlKeyColumns.push(column);
		}
	}
	this.sortedColumns = Object.keys(this.columns);
	// Load-order: shortest first
	this.sortedColumns.sort(function (a, b) {
		return a.length - b.length;
	});
}
Config.prototype = {
	columnForPath: function (dataPath, type) {
		var columnKey = type + dataPath;
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
	
	var staticMethods = {
		sqlFromSchema: function (schema) {
			var condition = SchemaCondition.fromSchema(schema, config);
			var table = initialTableName;
			return 'SELECT ' + table + '.*\n\tFROM ' + escapedTable + ' ' + table + '\n\tWHERE ' + condition.sqlWhere(table, false, '\t');
		},
		// TODO: could be abstracted out?
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
		},
		save: function (connection, obj, callback) {
			var remainderObject = JSON.parse(JSON.stringify(obj)); // Copy, and also ensure it's JSON-friendly
			var updateObj = {};
			var wherePairs = [];
			var missingKeyColumns = [];
			// Longest first
			for (var i = config.sortedColumns.length - 1; i >= 0; i--) {
				var column = config.sortedColumns[i];
				var isKeyColumn = config.keyColumns.indexOf(column) !== -1;
				var key = config.deconstructColumn(column, false);
				var alias = config.columnForPath(key.path, key.type);
				if (!jsonPointer.has(obj, key.path) || typeof (value = jsonPointer.get(obj, key.path)) === 'undefined') {
					if (isKeyColumn) {
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
				if (isKeyColumn) {
					var pair = mysql.escapeId(alias) + "=" + mysql.escape(value);
					wherePairs.push(pair);
				} else {
					updateObj[alias] = value;
				}
			}
			if (missingKeyColumns.length === 0) {
				var updatePairs = [];
				for (var alias in updateObj) {
					updatePairs.push(mysql.escapeId(alias) + "=" + mysql.escape(updateObj[alias]));
				}
				var sql = 'UPDATE ' + escapedTable + '\n\tSET ' + updatePairs.join(',\n\t') + '\nWHERE ' + wherePairs.join(' AND ');
				connection.query(sql, callback);
			} else {
				if (missingKeyColumns.length !== 1) {
					throw new Error('Cannot have more than one missing key column: ' + missingKeyColumns);
				}
				var keyColumn = config.deconstructColumn(missingKeyColumns[0]);
				if (keyColumn.type !== 'integer' && keyColumn.type !== 'number') {
					throw new Error('Missing key column must be number: ' + missingKeyColumns);
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
					jsonPointer.set(obj, keyColumn.path, result.insertId);
					callback(null, result);
				});
			}
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
			console.log(sql);
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
		},
		fromRow: function (row) {
			var result = new NewClass();
			var errors = [];
			for (var key in row) {
				if (!Object.prototype.hasOwnProperty.call(row, key)) {
					continue;
				}
				var value = row[key];
				if (value === null) {
					continue;
				}
				key = config.deconstructColumn(key);
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
			return result;
		},
		cache: function () {
			function Cache() {
				return NewClass.apply(this, arguments);
			}
			Cache.prototype = Object.create(NewClass.prototype);
			for (var key in staticMethods) {
				Cache[key] = staticMethods[key];
			}
			
			var objectCache = {};
			Cache.fromRow = function (row) {
				var key = [];
				for (var i = 0; i < config.sqlKeyColumns.length; i++) {
					key[i] = row[config.sqlKeyColumns[i]];
				}
				var keyJson = JSON.stringify(key); // all scalar values, so this is deterministic
				if (keyJson in objectCache) {
					return objectCache[keyJson];
				} else {
					return objectCache[keyJson] = NewClass.fromRow(row);
				}
			};
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
	sql = sql.replace(/[ \t\r\n]+/g, ' ');
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
			return queryMethod.call(this, sql, inserts);
		}
		sql = mysql.format(sql, inserts);
		return queryMethod.call(this, sql, callback);
	}
};
publicApi.FakeConnection = FakeConnection;

module.exports = publicApi;